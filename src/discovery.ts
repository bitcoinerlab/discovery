//TODO: implement DescriptorsFactory, discover and getData.
//TODO: reimplement discover using immer
//TODO: change the names of hte interafces since they will collide with
//the interfaces in the descriptor package

import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';

import type { Network } from 'bitcoinjs-lib';
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
  beingFetched?: boolean;
  fetchTime?: number;
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
  beingFetched: boolean; // A flag indicating if the descriptor data is being fetched.
  fetchTime?: number;
  indices: {
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

    //TODO: make this private
    async discoverUnrangedDescriptor({
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
        if (!descriptor.indices[index])
          descriptor.indices[index] = {
            balance,
            beingFetched: balance > 0
          };
        if (balance > 0) {
          const unrangedDescriptor = descriptor.indices[index]!;
          unrangedDescriptor.balance = balance;
          unrangedDescriptor.beingFetched = true;
          const utxos = await explorer.fetchUtxos(address);
          if (typeof unrangedDescriptor.utxos === 'undefined')
            unrangedDescriptor.utxos = {};
          for (const utxo of utxos) {
            const utxoId = utxo.txHex + ':' + utxo.vout; //TODO: use txId
            if (!unrangedDescriptor.utxos[utxoId]) {
              unrangedDescriptor.utxos[utxoId] = {
                utxoId,
                txHex: utxo.txHex,
                vout: utxo.vout
              };
            }
          }
          unrangedDescriptor.beingFetched = false;
          unrangedDescriptor.fetchTime = Math.floor(Date.now() / 1000);
        }
      }
      return { used, balance };
    }

    //TODO: keep track of all addresses being fetched. throw if duplicated
    //addresses. This could be the case where i have a ranged descriptor and
    //then yet again the descriptor but unranged
    //Or I could have a descriptor using a pubkey and another one (corresponding
    //to the same address) that is using a bip32 scheme.
    //I don't want to count more funds than the ones I really have!!!
    //Maybe what i need to to is check whether the utxoId has been set in
    //other parts
    async discover({
      expression,
      gapLimit = 20, //https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#user-content-Address_gap_limit
      network
    }: {
      expression: string;
      gapLimit?: number;
      network: Network;
    }) {
      const networkId = getNetworkId(network);
      if (typeof this.data[networkId] === 'undefined') {
        this.data[networkId] = { networkId, descriptors: {} };
      }
      if (
        typeof this.data[networkId]!.descriptors[expression] === 'undefined'
      ) {
        this.data[networkId]!.descriptors[expression] = {
          expression,
          beingFetched: true,
          indices: {}
        };
      }
      const descriptor = this.data[networkId]!.descriptors[expression]!;
      if (expression.indexOf('*') !== -1) {
        for (
          let index = 0, consecutiveUnused = 0;
          consecutiveUnused < gapLimit;
          index++
        ) {
          const { used } = await this.discoverUnrangedDescriptor({
            expression,
            index,
            network
          });
          if (used) consecutiveUnused = 0;
          else consecutiveUnused++;
        }
      } else {
        await this.discoverUnrangedDescriptor({
          expression,
          index: 'non-ranged',
          network
        });
      }
      descriptor.beingFetched = false;
      descriptor.fetchTime = Math.floor(Date.now() / 1000);
    }

    getData() {
      return this.data;
    }
  }
  return { Discovery };
}
