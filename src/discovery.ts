//TODO: Implement scriptPubKeyDuplicated

import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';

import { Network, crypto } from 'bitcoinjs-lib';
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

type TxInfo = {
  txId: string;
  blockHeight: number;
  irreversible: boolean;
  txHex?: string;
};

type ScriptPubKeyInfo = {
  //Last time the scriptPubKey was fetched
  txIds: Array<TxInfo>;
  fetchTime: number;
};

/**
 * Represents the descriptor index for a ranged descriptor (number) or marks
 * this descriptor as non-ranged.
 */
type Expression = string;
type DescriptorIndex = number | 'non-ranged';

/**
 * Represents a descriptor, which can be either a ranged descriptor or a non-ranged descriptor.
 */
type DescriptorInfo = {
  expression: Expression; // The descriptor string in ASCII format, possibly including a wildcard (*).
  fetchingScriptPubKeyInfoRecords: boolean; // A flag indicating if the descriptor data is being fetched.
  descriptorFetchTime?: number;
  gapLimit?: number; //A flag indicating what was the last gapLimit used (only set for ranged descriptors)
  //Will only be set when txCount > 0
  scriptPubKeyInfoRecords?: Record<DescriptorIndex, ScriptPubKeyInfo>;
};

type NetworkInfo = {
  networkId: NetworkId; // An enum representing the network ID
  descriptorInfoRecords: Record<Expression, DescriptorInfo>;
};

type DiscoveryInfo = Record<NetworkId, NetworkInfo>;

export function DiscoveryFactory(explorer: Explorer) {
  /**
   * A class to discover funds in a Bitcoin wallet using descriptors.
   */
  class Discovery {
    discoveryInfo: DiscoveryInfo;

    /**
     * Constructs a Discovery instance.
     * @param {Explorer} explorer - The explorer instance.
     */
    constructor() {
      this.discoveryInfo = <DiscoveryInfo>{};
    }

    async updateScriptPubKeyInfo({
      expression,
      index,
      network
    }: {
      expression: string;
      index: DescriptorIndex;
      network: Network;
    }): Promise<{ balance: number; txCount: number }> {
      const networkId = getNetworkId(network);
      const descriptorInfo =
        this.discoveryInfo[networkId]?.descriptorInfoRecords[expression];
      if (!descriptorInfo)
        throw new Error(`data structure not ready for ${expression}`);

      const scriptPubKey =
        index === 'non-ranged'
          ? new Descriptor({ expression, network }).getScriptPubKey()
          : new Descriptor({ expression, network, index }).getScriptPubKey();
      //https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes
      const scriptHash = crypto.sha256(scriptPubKey).toString('hex');
      const txs = await explorer.fetchTxHistory({ scriptHash });
      return { txCount: txs.length, balance: txs.length /*TODO: obviously*/ };
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
      if (!this.discoveryInfo[networkId]) {
        this.discoveryInfo[networkId] = {
          networkId,
          descriptorInfoRecords: {}
        };
      }

      const expressionArray = Array.isArray(expression)
        ? expression
        : [expression];

      for (const expression of expressionArray) {
        if (
          typeof this.discoveryInfo[networkId]!.descriptorInfoRecords[
            expression
          ] === 'undefined'
        ) {
          this.discoveryInfo[networkId]!.descriptorInfoRecords[expression] = {
            expression,
            fetchingScriptPubKeyInfoRecords: true,
            scriptPubKeyInfoRecords: <
              Record<DescriptorIndex, ScriptPubKeyInfo>
            >{}
          };
        }
        const descriptorInfo =
          this.discoveryInfo[networkId]!.descriptorInfoRecords[expression]!;
        descriptorInfo.fetchingScriptPubKeyInfoRecords = true;
        if (expression.indexOf('*') !== -1) {
          descriptorInfo.gapLimit = gapLimit;
          for (let index = 0, gap = 0; gap < gapLimit; index++) {
            const { txCount } = await this.updateScriptPubKeyInfo({
              expression,
              index,
              network
            });
            if (txCount) gap = 0;
            else gap++;
            if (txCount && next && !nextPromise) nextPromise = next();
          }
        } else {
          const { txCount } = await this.updateScriptPubKeyInfo({
            expression,
            index: 'non-ranged',
            network
          });
          if (txCount && next && !nextPromise) nextPromise = next();
        }
        descriptorInfo.fetchingScriptPubKeyInfoRecords = false;
        descriptorInfo.descriptorFetchTime = Math.floor(Date.now() / 1000);
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

    getDiscoveryInfo() {
      return this.discoveryInfo;
    }
  }
  return { Discovery };
}
