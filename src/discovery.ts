//TODO: method getNextScriptPubKey
//TODO: getWallets + getDescriptors should be renamed to deriveWallets + deriveDescriptors
//and return the same reference if they don't change.
//TODO: ??? getUtxos should also return the same reference. Create deriveUtxos???
//TODO: Timeouts on //host: 'fulcrum.theuplink.net', //TIMEOUT. Reconnect and retry?
//https://blog.keys.casa/electrum-server-performance-report-2022/
//TODO - done but lacks some adding a test: getWallets and getDescriptors is wrong. It must make sure there are scriptPubKeyInfoRecords
//TODO - now I have an error with getWallets because if the change has not been used then
//it won't be returned - Is that acceptable? If so, document.
//TODO: deriveUtxosBalance is not memoized!!! Yeah... search space is too large to memoize it. Can we do better? Maybe have a memoized
//function for each networkId and then using max: 10 for example? Like assuming
//  -> In fact the problem is I need deriveExpressionsBalance or deriveBalance... That is the one that needs to be memoized with max: 100 or something
//TODO: did secondCall go bananas after memoization?!?! :-/ It should be around 4-5 secs if firstcall is around 30secs
//TODO: Add comments about Search Space on deriveData.ts
//TODO: go over all memoizeOneWithShallowArraysCheck and see if the returned Arrays are always in same order!
import { produce } from 'immer';
import { shallowEqualArrays } from 'shallow-equal';

import {
  getNetworkId,
  getScriptPubKey,
  deriveScriptPubKeyUtxos,
  deriveUtxos,
  deriveUtxosBalance,
  deriveExpressions,
  getWallets
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

    /**
     * Retrieves an array of descriptor expressions associated with a specific
     * network.
     *
     * @param {Network} network - The network associated with the descriptors.
     *
     * @returns {Array<Expression>} - Returns an array of descriptor expressions.
     * These are derived from the discovery information of the wallet and the
     * provided network. Note on mutability (useful in environments like React):
     * This function will maintain the same object reference per networkId
     * if the returned array hasn't changed (shallow equality).
     */
    getDescriptors({ network }: { network: Network }): Array<Expression> {
      const networkId = getNetworkId(network);
      return deriveExpressions(this.discoveryInfo, networkId);
    }

    /**
     * Retrieves wallet descriptors grouped by wallets. A wallet is identified
     * by descriptors with the same script type and a single ranged key
     * expression for a key that shares the same fingerprint and origin
     * path. The key expressions should be either /0/* or /1/*.
     *
     * @param {Network} network - The network associated with the descriptors.
     *
     * @returns {Array<Array<Expression>>} - An array of wallets, each represented
     * as an array of descriptor expressions. Note on mutability (useful in
     * environments like React): This method will maintain the same object
     * reference per networkId if the deep structure of the returned object remains
     * unchanged.
     */
    getWallets({ network }: { network: Network }): Array<Array<Expression>> {
      const expressions = this.getDescriptors({ network });
      const networkId = getNetworkId(network);
      return getWallets(networkId, expressions);
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
      const scriptHash = Buffer.from(crypto.sha256(scriptPubKey))
        .reverse()
        .toString('hex');
      type TxHistory = {
        txId: string;
        blockHeight: number;
        irreversible: boolean;
      };

      const txHistoryArray: Array<TxHistory> = await explorer.fetchTxHistory({
        scriptHash
      });
      //console.log('TRACE', { scriptHash, txHistoryArray });

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
        if (txIds.length) {
          if (!scriptPubKeyInfo) {
            scriptPubKeyInfoRecords[index] = { txIds, timeFetched: now() };
          } else {
            if (!shallowEqualArrays(txIds, scriptPubKeyInfo.txIds)) {
              scriptPubKeyInfo.txIds = txIds;
            }
            scriptPubKeyInfo.timeFetched = now();
          }
        } else {
          if (scriptPubKeyInfo) {
            delete scriptPubKeyInfoRecords[index];
          }
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
      balance = deriveUtxosBalance(this.discoveryInfo, networkId, utxos);
      return balance;
    }
    getBalance({
      expressions,
      network,
      txStatus
    }: {
      expressions: Expression | Array<Expression>;
      network: Network;
      txStatus: TxStatus;
    }): number {
      const networkId = getNetworkId(network);
      const utxos = this.getUtxos({ expressions, network, txStatus });
      return deriveUtxosBalance(this.discoveryInfo, networkId, utxos);
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
      expressions,
      network,
      txStatus
    }: {
      expressions: Expression | Array<Expression>;
      network: Network;
      txStatus: TxStatus;
    }): Array<Utxo> {
      const networkId = getNetworkId(network);
      return deriveUtxos(this.discoveryInfo, networkId, expressions, txStatus);
    }

    /**
     * Fetches a descriptor or descriptors and returns a Promise that
     * resolves when fetched.
     */
    async discover({
      expressions,
      gapLimit = 20,
      network,
      onUsed,
      next
    }: {
      expressions: Expression | Array<Expression>;
      gapLimit?: number;
      network: Network;
      onUsed?: (expressions: Expression | Array<Expression>) => void;
      next?: () => Promise<void>;
    }) {
      let nextPromise;
      let usedExpressions = false;
      let usedExpressionsNotified = false;

      const expressionArray = Array.isArray(expressions)
        ? expressions
        : [expressions];
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

          if (used) {
            usedExpressions = true;
            gap = 0;
          } else gap++;

          if (used && next && !nextPromise) nextPromise = next();

          index++;

          if (used && onUsed && usedExpressionsNotified === false) {
            onUsed(expressions);
            usedExpressionsNotified = true;
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

      const promises = [];
      if (usedExpressions) promises.push(this.discoverTxs({ network }));
      if (nextPromise) promises.push(nextPromise);
      await Promise.all(promises);
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

    async discoverStandardWallets({
      masterNode,
      gapLimit = 20,
      network,
      onUsed
    }: {
      masterNode: BIP32Interface;
      gapLimit?: number;
      network: Network;
      onUsed?: (expressions: Expression | Array<Expression>) => void;
    }) {
      const discoveryTasks = [];
      const { pkhBIP32, shWpkhBIP32, wpkhBIP32 } = scriptExpressions;
      for (const expressionFn of [pkhBIP32, shWpkhBIP32, wpkhBIP32]) {
        let account = 0;
        const next = async () => {
          const expressions = [0, 1].map(change =>
            expressionFn({ masterNode, network, account, change, index: '*' })
          );
          //console.log('STANDARD', { expressions, gapLimit, account });
          account++;
          await this.discover({
            expressions,
            gapLimit,
            network,
            next,
            ...(onUsed ? { onUsed } : {})
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
