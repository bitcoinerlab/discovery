import { produce } from 'immer';
import { shallowEqualArrays } from 'shallow-equal';

import {
  getNetworkId,
  getScriptPubKey,
  deriveScriptPubKeyUtxos,
  deriveUtxosBalance
} from './deriveData';

import { scriptExpressions } from '@bitcoinerlab/descriptors';

import { Network, crypto } from 'bitcoinjs-lib';
import type { BIP32Interface } from 'bip32';
import type { Explorer } from '@bitcoinerlab/explorer';

import {
  NetworkId,
  TxId,
  TxHex,
  TxInfo,
  ScriptPubKeyInfo,
  Expression,
  DescriptorIndex,
  DescriptorInfo,
  NetworkInfo,
  DiscoveryInfo,
  Utxo,
  TxStatus
} from './types';

const now = () => Math.floor(Date.now() / 1000);

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
      this.discoveryInfo = {} as DiscoveryInfo;
      for (const networkId of Object.values(NetworkId)) {
        const txInfoRecords: Record<TxId, TxInfo> = {};
        const descriptors: Record<Expression, DescriptorInfo> = {};
        const networkInfo: NetworkInfo = {
          descriptors,
          txInfoRecords
        };
        this.discoveryInfo[networkId] = networkInfo;
      }
    }

    async discoverScriptPubKey({
      expression,
      index,
      network
    }: {
      expression: Expression;
      index: DescriptorIndex;
      network: Network;
    }): Promise<boolean> {
      const networkId = getNetworkId(network);
      const scriptPubKey = getScriptPubKey(networkId, expression, index);
      //https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes
      const scriptHash = crypto.sha256(scriptPubKey).toString('hex');
      type TxHistory = {
        txId: string;
        blockHeight: number;
        irreversible: boolean;
      };

      const txHistoryArray: Array<TxHistory> = await explorer.fetchTxHistory({
        scriptHash
      });

      this.discoveryInfo = produce(this.discoveryInfo, discoveryInfo => {
        // Update txInfoRecords
        const txInfoRecords = discoveryInfo[networkId].txInfoRecords;
        txHistoryArray.forEach(({ txId, irreversible, blockHeight }) => {
          const txInfo = txInfoRecords[txId];
          if (!txInfo) {
            txInfoRecords[txId] = { irreversible, blockHeight };
          } else {
            txInfo.irreversible = irreversible;
            txInfo.blockHeight = blockHeight;
          }
        });
        //Update descriptors
        const scriptPubKeyInfoRecords =
          discoveryInfo[networkId].descriptors[expression]
            ?.scriptPubKeyInfoRecords;
        if (!scriptPubKeyInfoRecords)
          throw new Error(
            `scriptPubKeyInfoRecords does not exist for ${networkId} and ${expression}`
          );
        const scriptPubKeyInfo = scriptPubKeyInfoRecords[index];
        const txIds = txHistoryArray.map(txHistory => txHistory.txId);
        if (!scriptPubKeyInfo) {
          scriptPubKeyInfoRecords[index] = { txIds, timeFetched: now() };
        } else {
          if (!shallowEqualArrays(txIds, scriptPubKeyInfo.txIds)) {
            scriptPubKeyInfo.txIds = txIds;
          }
          scriptPubKeyInfo.timeFetched = now();
        }
      });
      return !!txHistoryArray.length;
    }

    getBalanceScriptPubKey({
      expression,
      index,
      network,
      txStatus
    }: {
      expression: Expression;
      index: DescriptorIndex;
      network: Network;
      txStatus: TxStatus;
    }): number {
      let balance: number = 0;
      const networkId = getNetworkId(network);
      const utxos = this.getUtxosScriptPubKey({
        expression,
        index,
        network,
        txStatus
      });
      balance = deriveUtxosBalance(utxos, this.discoveryInfo, networkId);
      return balance;
    }
    getBalance({
      expression,
      network,
      txStatus
    }: {
      expression: Expression | Array<Expression>;
      network: Network;
      txStatus: TxStatus;
    }): number {
      let balance: number = 0;
      const expressionArray = Array.isArray(expression)
        ? expression
        : [expression];
      const networkId = getNetworkId(network);
      for (const expression of expressionArray) {
        const utxos = this.getUtxos({ expression, network, txStatus });
        balance += deriveUtxosBalance(utxos, this.discoveryInfo, networkId);
      }
      return balance;
    }

    getUtxosScriptPubKey({
      expression,
      index,
      network,
      txStatus
    }: {
      expression: Expression;
      index: DescriptorIndex;
      network: Network;
      txStatus: TxStatus;
    }): Utxo[] {
      const networkId = getNetworkId(network);
      return deriveScriptPubKeyUtxos(
        this.discoveryInfo,
        networkId,
        expression,
        index,
        txStatus
      );
    }

    getUtxos({
      expression,
      network,
      txStatus
    }: {
      expression: Expression | Array<Expression>;
      network: Network;
      txStatus: TxStatus;
    }): Utxo[] {
      const utxos: Utxo[] = [];
      const expressionArray = Array.isArray(expression)
        ? expression
        : [expression];
      const networkId = getNetworkId(network);
      const networkInfo = this.discoveryInfo[networkId];
      for (const expression of expressionArray) {
        const scriptPubKeyInfoRecords =
          networkInfo.descriptors[expression]?.scriptPubKeyInfoRecords || [];
        for (const indexStr in scriptPubKeyInfoRecords) {
          const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
          utxos.push(
            ...this.getUtxosScriptPubKey({
              network,
              expression,
              index,
              txStatus
            })
          );
        }
      }

      //Deduplucate in case of expression: Array<Expression> with duplicated
      //expressions
      const dedupedUtxos = [...new Set(utxos)];
      return dedupedUtxos;
    }

    /**
     * Fetches a descriptor or descriptors and returns a Promise that
     * resolves when fetched.
     */
    async discover({
      expression,
      gapLimit = 20,
      network,
      onUsedDescriptor,
      next
    }: {
      expression: Expression | Array<Expression>;
      gapLimit?: number;
      network: Network;
      onUsedDescriptor?: (expression: Expression) => void;
      next?: () => Promise<void>;
    }) {
      let nextPromise;
      let usedDescriptorNotified = false;

      const expressionArray = Array.isArray(expression)
        ? expression
        : [expression];
      const networkId = getNetworkId(network);
      for (const expression of expressionArray) {
        this.discoveryInfo = produce(this.discoveryInfo, discoveryInfo => {
          const descriptorInfo =
            discoveryInfo[networkId].descriptors[expression];
          if (!descriptorInfo) {
            discoveryInfo[networkId].descriptors[expression] = {
              timeFetched: 0,
              fetching: true,
              scriptPubKeyInfoRecords: {} as Record<
                DescriptorIndex,
                ScriptPubKeyInfo
              >
            };
          } else {
            descriptorInfo.fetching = true;
          }
        });

        let gap = 0;
        let index = 0;
        const isRanged = expression.indexOf('*') !== -1;
        while (isRanged ? gap < gapLimit : index < 1) {
          const used = await this.discoverScriptPubKey({
            expression,
            index: isRanged ? index : 'non-ranged',
            network
          });

          if (used) gap = 0;
          else gap++;

          if (used && next && !nextPromise) nextPromise = next();

          index++;

          if (used && onUsedDescriptor && usedDescriptorNotified === false) {
            onUsedDescriptor(expression);
            usedDescriptorNotified = true;
          }
        }
        this.discoveryInfo = produce(this.discoveryInfo, discoveryInfo => {
          const descriptorInfo =
            discoveryInfo[networkId].descriptors[expression];
          if (!descriptorInfo)
            throw new Error(
              `Descriptor for ${networkId} and ${expression} does not exist`
            );
          descriptorInfo.fetching = false;
          descriptorInfo.timeFetched = now();
        });
      }
      if (nextPromise) await nextPromise;
    }

    /**
     * Fetches all txs of a certain network.
     */
    async discoverTxs({ network }: { network: Network }) {
      const txHexRecords: Record<TxId, TxHex> = {};
      const networkId = getNetworkId(network);
      const networkInfo = this.discoveryInfo[networkId];
      for (const expression in networkInfo.descriptors) {
        const scriptPubKeyInfoRecords =
          networkInfo.descriptors[expression]?.scriptPubKeyInfoRecords || [];
        for (const index in scriptPubKeyInfoRecords) {
          const txIds = scriptPubKeyInfoRecords[index]?.txIds;
          if (!txIds)
            throw new Error(
              `Error: cannot retrieve txs for nonexising scriptPubKey: ${networkId}, ${expression}, ${index}`
            );
          for (const txId of txIds)
            if (!networkInfo.txInfoRecords[txId]?.txHex)
              txHexRecords[txId] = await explorer.fetchTx(txId);
        }
      }
      if (Object.keys(txHexRecords).length) {
        this.discoveryInfo = produce(this.discoveryInfo, discoveryInfo => {
          for (const txId in txHexRecords) {
            const txHex = txHexRecords[txId];
            if (!txHex) throw new Error(`txHex not retrieved for ${txId}`);
            const txInfo = discoveryInfo[networkId].txInfoRecords[txId];
            if (!txInfo) throw new Error(`txInfo does not exist for ${txId}`);
            txInfo.txHex = txHex;
          }
        });
      }
    }

    async discoverStandard({
      masterNode,
      gapLimit = 20,
      network,
      onUsedDescriptor
    }: {
      masterNode: BIP32Interface;
      gapLimit?: number;
      network: Network;
      onUsedDescriptor?: (expression: Expression) => void;
    }) {
      const discoveryTasks = [];
      const { pkhBIP32, shWpkhBIP32, wpkhBIP32 } = scriptExpressions;
      for (const expressionFn of [pkhBIP32, shWpkhBIP32, wpkhBIP32]) {
        let account = 0;
        const next = async () => {
          const expression = [0, 1].map(change =>
            expressionFn({ masterNode, network, account, change, index: '*' })
          );
          //console.log('STANDARD', { expression, gapLimit, account });
          account++;
          await this.discover({
            expression,
            gapLimit,
            network,
            next,
            ...(onUsedDescriptor ? { onUsedDescriptor } : {})
          });
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
