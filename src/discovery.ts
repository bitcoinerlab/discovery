//TODO: reimplement discover using immer
//TODO: implement discoverStandard()
//TODO: fetchUtxos should be done after all the balances have been retrieved
//since this is a very slow procedur and anyway I don't need the utxos until
//I want to spend.

import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';

import { Network, Transaction } from 'bitcoinjs-lib';
import type { BIP32Interface } from 'bip32';
import type { Explorer } from '@bitcoinerlab/explorer';

const { Descriptor } = descriptors.DescriptorsFactory(secp256k1);

enum NetworkId {
  BITCOIN = 'BITCOIN',
  REGTEST = 'REGTEST',
  TESTNET = 'TESTNET',
  SIGNET = 'SIGNET'
}

const getNetworkId = (network: Network): NetworkId => {
  if (network.bech32 === 'bc') return NetworkId.BITCOIN;
  if (network.bech32 === 'bcrt') return NetworkId.REGTEST;
  if (network.bech32 === 'tb') return NetworkId.TESTNET;
  if (network.bech32 === 'sb') return NetworkId.SIGNET;
  throw new Error('Unknown network');
};

/**
 * Represents a UTXO identifier, a combination of the transaction ID and output number.
 */
type UtxoId = string;

/**
 * Represents a UTXO (Unspent Transaction Output).
 */
type Utxo = {
  utxoId: UtxoId; // The UTXO identifier, composed of the transaction ID and the output index, separated by a colon (e.g., "txId:vout").
  txHex: string; // The transaction ID in hex format.
  vout: number; // The output index (an integer >= 0).
};

/**
 * Represents a set of UTXOs with associated metadata.
 */
type UtxoSetData = {
  //balance will be zero if this address was used in the past but has no more balance
  balance: number;
  //the props below will be not set if used but balance = 0;
  utxosBeingFetched?: boolean;
  indexFetchTime?: number;
  utxos?: {
    [utxoId: UtxoId]: Utxo;
  };
};

/**
 * Represents the descriptor index for a ranged descriptor (number) or marks
 * this descriptor as non-ranged.
 */
type DescriptorIndex = number | 'non-ranged';

/**
 * Represents a descriptor, which can be either a ranged descriptor or a non-ranged descriptor.
 */
interface DescriptorData {
  expression: string; // The descriptor string in ASCII format, possibly including a wildcard (*).
  indicesBeingFetched: boolean; // A flag indicating if the descriptor data is being fetched.
  descriptorFetchTime?: number;
  gapLimit?: number; //A flag indicating what was the last gapLimit used (only set for ranged descriptors)
  usedIndices: {
    //Will only be set when either the address has balance or had in the past
    [K in DescriptorIndex]?: UtxoSetData;
  };
}

export function DiscoveryFactory(explorer: Explorer) {
  /**
   * A class to discover funds in a Bitcoin wallet using descriptors.
   */
  class Discovery {
    data: {
      [networkId: string]: {
        networkId: NetworkId; // An enum representing the network ID
        descriptors: {
          [expression: string]: DescriptorData; // An object containing ranged descriptors (with wildcard *) and non-ranged descriptors.
        };
      };
    };

    /**
     * Constructs a Discovery instance.
     * @param {Explorer} explorer - The explorer instance.
     */
    constructor() {
      this.data = {};
    }

    /**
     * Check whether this utxoId has already been discovered
     * in another part of the data structure (that does not correspond to the
     * current expression and index).
     * This check will be used to detect data failures that could lead to count
     * duplicated funds.
     * This could be the case where a ranged descriptor is used and then yet
     * again the same descriptor was put into the data pool but unranged.
     * Or the case where a descriptor is using a pubkey and another one
     * (corresponding to the same address) uses a bip32 scheme.
     */
    utxoIdDuplicated({
      utxoId,
      networkId,
      expression,
      index
    }: {
      utxoId: UtxoId;
      networkId: NetworkId;
      expression: string;
      index: DescriptorIndex;
    }): boolean {
      const networkData = this.data[networkId];
      if (!networkData) return false;
      const { descriptors } = networkData;

      for (const _expression in descriptors) {
        const descriptor = descriptors[_expression];
        if (!descriptor) throw new Error(`Error: undefined descriptor`);
        for (const _index in descriptor.usedIndices) {
          const utxoSet = descriptor.usedIndices[_index];
          if (
            utxoSet &&
            utxoSet.utxos &&
            utxoSet.utxos[utxoId] &&
            (expression !== _expression || index !== _index)
          ) {
            return true;
          }
        }
      }
      return false;
    }

    async fetchAddress({
      expression,
      network,
      index
    }: {
      expression: string;
      network: Network;
      index: DescriptorIndex;
    }) {
      const networkId = getNetworkId(network);
      const descriptor = this.data[networkId]!.descriptors[expression]!;
      const address =
        index === 'non-ranged'
          ? new Descriptor({
              expression,
              network
            }).getAddress()
          : new Descriptor({
              expression,
              network,
              index
            }).getAddress();
      const { used, balance } = await explorer.fetchAddress(address);
      if (used) {
        if (!descriptor.usedIndices[index])
          descriptor.usedIndices[index] = { balance };
        if (balance > 0) {
          const unrangedDescriptor = descriptor.usedIndices[index]!;
          unrangedDescriptor.balance = balance;
          unrangedDescriptor.utxosBeingFetched = true;
          const utxos = await explorer.fetchUtxos(address);
          if (typeof unrangedDescriptor.utxos === 'undefined')
            unrangedDescriptor.utxos = {};
          for (const utxo of utxos) {
            const txId = Transaction.fromHex(utxo.txHex).getId();
            const utxoId = txId + ':' + utxo.vout;
            if (this.utxoIdDuplicated({ utxoId, networkId, expression, index }))
              throw new Error(`Error: duplicated utxoId: ${utxoId}`);
            if (!unrangedDescriptor.utxos[utxoId]) {
              unrangedDescriptor.utxos[utxoId] = {
                utxoId,
                txHex: utxo.txHex,
                vout: utxo.vout
              };
            }
          }
          unrangedDescriptor.utxosBeingFetched = false;
          unrangedDescriptor.indexFetchTime = Math.floor(Date.now() / 1000);
        }
      }
      return { used, balance };
    }

    /**
     * Fetches a descriptor or descriptors and returns a Promise that
     * resolves when fetched.
     */
    async discover({
      expression,
      gapLimit = 20,
      network,
      next
    }: {
      expression: string | string[];
      gapLimit?: number;
      network: Network;
      next?: () => Promise<void>;
    }) {
      let nextPromise;
      const networkId = getNetworkId(network);
      if (typeof this.data[networkId] === 'undefined') {
        this.data[networkId] = { networkId, descriptors: {} };
      }

      const expressionArray = Array.isArray(expression)
        ? expression
        : [expression];

      for (const expression of expressionArray) {
        if (
          typeof this.data[networkId]!.descriptors[expression] === 'undefined'
        ) {
          this.data[networkId]!.descriptors[expression] = {
            expression,
            indicesBeingFetched: true,
            usedIndices: {}
          };
        }
        const descriptor = this.data[networkId]!.descriptors[expression]!;
        if (expression.indexOf('*') !== -1) {
          descriptor.gapLimit = gapLimit;
          for (let index = 0, gap = 0; gap < gapLimit; index++) {
            const { used } = await this.fetchAddress({
              expression,
              index,
              network
            });
            if (used) gap = 0;
            else gap++;
            if (used && next && !nextPromise) nextPromise = next();
          }
        } else {
          const { used } = await this.fetchAddress({
            expression,
            index: 'non-ranged',
            network
          });
          if (used && next && !nextPromise) nextPromise = next();
        }
        descriptor.indicesBeingFetched = false;
        descriptor.descriptorFetchTime = Math.floor(Date.now() / 1000);
      }
      if (nextPromise) await nextPromise;
    }

    async discoverStandard({
      masterNode,
      gapLimit = 20,
      network
    }: {
      masterNode: BIP32Interface;
      gapLimit?: number;
      network: Network;
    }) {
      const discoveryTasks = [];
      const { pkhBIP32, shWpkhBIP32, wpkhBIP32 } =
        descriptors.scriptExpressions;
      for (const expressionFn of [pkhBIP32, shWpkhBIP32, wpkhBIP32]) {
        let account = 0;
        const next = async () => {
          const expression = [0, 1].map(change =>
            expressionFn({ masterNode, network, account, change, index: '*' })
          );
          console.log('STANDARD', { expression, gapLimit, account });
          account++;
          await this.discover({ expression, gapLimit, network, next });
        };
        discoveryTasks.push(next());
      }
      await Promise.all(discoveryTasks);
    }

    getData() {
      return this.data;
    }
  }
  return { Discovery };
}
