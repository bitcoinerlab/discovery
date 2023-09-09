// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

import { produce } from 'immer';
import { shallowEqualArrays } from 'shallow-equal';

import { canonicalize, deriveDataFactory } from './deriveData';

import { getNetworkId } from './networks';

import { scriptExpressions } from '@bitcoinerlab/descriptors';

import { Network, crypto, Transaction } from 'bitcoinjs-lib';
import type { BIP32Interface } from 'bip32';
import type { Explorer } from '@bitcoinerlab/explorer';

import {
  NetworkId,
  TxId,
  TxHex,
  TxInfo,
  ScriptPubKeyInfo,
  Expression,
  Account,
  DescriptorIndex,
  DescriptorInfo,
  NetworkInfo,
  DiscoveryInfo,
  Utxo,
  TxStatus
} from './types';

const now = () => Math.floor(Date.now() / 1000);

/**
 * Creates and returns a Discovery class for discovering funds in a Bitcoin wallet
 * using descriptors. The class provides methods for descriptor expression discovery,
 * balance checking, transaction status checking, and so on.
 *
 * @returns A Discovery class, constructed with the given explorer instance.
 */
export function DiscoveryFactory(
  /**
   * The explorer instance that communicates with the
   * Bitcoin network. It is responsible for fetching blockchain data like UTXOs,
   * transaction details, etc.
   */
  explorer: Explorer
) {
  /**
   * A class to discover funds in a Bitcoin wallet using descriptors.
   * The {@link DiscoveryFactory | `DiscoveryFactory`} function internally creates and returns an instance of this class.
   * The returned class is specialized for the provided `Explorer`, which is responsible for fetching blockchain data like transaction details.
   */
  class Discovery {
    #derivers: ReturnType<typeof deriveDataFactory>;
    discoveryInfo: DiscoveryInfo;

    /**
     * Constructs a Discovery instance. Discovery is used to discover funds
     * in a Bitcoin wallet using descriptors.
     *
     * @param options
     */
    constructor(
      {
        expressionsCacheSize = 1000,
        indicesPerExpressionCacheSize = 10000
      }: {
        /**
         * Cache size limit for descriptor expressions per network.
         * The cache is used to speed up data queries by avoiding unnecessary
         * recomputations. However, it is essential to manage the memory
         * usage of the application. If the cache size is unbounded, it could lead
         * to excessive memory usage and degrade the application's performance,
         * especially when dealing with a large number of descriptor expressions.
         * On the other hand, a very small cache size may lead to more frequent cache
         * evictions, causing the library to return a different reference for the same data
         * when the same method is called multiple times, even if the underlying data has not
         * changed. This is contrary to the immutability principles that the library is built upon.
         * Ultimately, this limit acts as a trade-off between memory usage, computational efficiency,
         * and immutability. Set to 0 for unbounded caches.
         * @defaultValue 1000
         */
        expressionsCacheSize: number;
        /**
         * Cache size limit for indices per expression, related to the number of addresses
         * in ranged descriptor expressions. Similar to the `expressionsCacheSize`,
         * this cache is used to speed up data queries and avoid recomputations.
         * As each expression can have multiple indices, the number of indices can grow rapidly,
         * leading to increased memory usage. Setting a limit helps keep memory usage in check,
         * while also maintaining the benefits of immutability and computational efficiency.
         * Set to 0 for unbounded caches.
         * @defaultValue 10000
         */
        indicesPerExpressionCacheSize: number;
      } = {
        expressionsCacheSize: 1000,
        indicesPerExpressionCacheSize: 10000
      }
    ) {
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
      this.#derivers = deriveDataFactory({
        expressionsCacheSize,
        indicesPerExpressionCacheSize
      });
    }

    /**
     * Ensures that a scriptPubKey is unique and has not already been set by
     * a different descriptor. This prevents accounting for duplicate unspent
     * transaction outputs (utxos) and balances when different descriptors could
     * represent the same scriptPubKey (e.g., xpub vs wif).
     *
     * @throws If the scriptPubKey is not unique.
     * @private
     * @param options
     */
    #ensureScriptPubKeyUniqueness({
      networkId,
      scriptPubKey
    }: {
      /**
       * Network to check.
       */
      networkId: NetworkId;
      /**
       * The scriptPubKey to check for uniqueness.
       */
      scriptPubKey: Buffer;
    }) {
      const descriptors = this.discoveryInfo[networkId].descriptors;
      const expressions = this.#derivers.deriveExpressions(
        this.discoveryInfo,
        networkId
      );
      expressions.forEach(expression => {
        const scriptPubKeyInfoRecords =
          descriptors[expression]?.scriptPubKeyInfoRecords ||
          ({} as Record<DescriptorIndex, ScriptPubKeyInfo>);

        Object.keys(scriptPubKeyInfoRecords).forEach(indexStr => {
          const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
          if (
            scriptPubKey.equals(
              this.#derivers.deriveScriptPubKey(networkId, expression, index) //This will be very fast (uses memoization)
            )
          ) {
            throw new Error(
              `The provided scriptPubKey is already set: ${expression}, ${index}.`
            );
          }
        });
      });
    }

    /**
     * Asynchronously discovers a scriptPubKey, given a descriptor expression,
     * descriptor index, and network. It first retrieves the scriptPubKey,
     * computes its scriptHash, and fetches the transaction history associated
     * with this scriptHash from the explorer. It then updates the internal
     * discoveryInfo accordingly.
     *
     * This function has side-effects as it modifies the internal discoveryInfo
     * state of the Discovery class instance. This state keeps track of
     * transaction info and descriptors relevant to the discovery process.
     *
     * This method is useful for updating the state of the wallet based on new
     * transactions and scriptPubKeys.
     *
     * @param options
     * @returns A promise that resolves to a boolean indicating whether any transactions were found for the provided scriptPubKey.
     */
    async discoverScriptPubKey({
      expression,
      index,
      network
    }: {
      /**
       * The descriptor expression associated with the scriptPubKey to discover.
       */
      expression: Expression;
      /**
       * The descriptor index associated with the scriptPubKey to discover.
       */
      index: DescriptorIndex;
      /**
       * The network associated with the scriptPubKey to discover.
       */
      network: Network;
    }): Promise<boolean> {
      expression = canonicalize(expression, network) as string;
      const networkId = getNetworkId(network);
      const scriptPubKey = this.#derivers.deriveScriptPubKey(
        networkId,
        expression,
        index
      );
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
            this.#ensureScriptPubKeyUniqueness({ networkId, scriptPubKey });
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

    /**
     * Asynchronously fetches all transactions associated with a specific network.
     *
     * @param options
     * @returns Resolves when all the transactions for the provided network have been fetched and stored in discoveryInfo.
     */
    async discoverTxs({
      network
    }: {
      /**
       * The network whose transactions are to be fetched.
       */
      network: Network;
    }) {
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

    /**
     * Asynchronously fetches one or more descriptor expressions.
     *
     * @param options
     * @returns Resolves when the fetch operation completes. If used expressions are found, waits for the discovery of associated transactions.
     */
    async discover({
      expressions,
      gapLimit = 20,
      network,
      onUsed,
      next
    }: {
      /**
       * The descriptor expression(s) to be fetched. Can be a single expression or an array.
       */
      expressions: Expression | Array<Expression>;
      /**
       * The gap limit for the fetch operation.
       * @defaultValue 20
       */
      gapLimit?: number;
      /**
       * The network associated with the expressions.
       */
      network: Network;
      /**
       * Optional callback function. Invoked when a used expression is found. Provided with the same input descriptor expressions.
       */
      onUsed?: (expression: Expression | Array<Expression>) => void;
      /**
       * Optional function that returns a Promise. Invoked once a used expression is found and the Promise it returns is awaited.
       */
      next?: () => Promise<void>;
    }) {
      const inputExpressions = expressions;
      expressions = canonicalize(expressions, network);
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
            onUsed(inputExpressions);
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
     * Asynchronously discovers standard accounts (pkh, sh(wpkh), wpkh) associated
     * with a master node in a specific network. It uses a given gap limit for
     * wallet discovery.
     *
     * @param options
     * @returns Resolves when all the accounts from the master node have been discovered.
     */
    async discoverStandardAccounts({
      masterNode,
      gapLimit = 20,
      network,
      onAccountUsed
    }: {
      /**
       * The master node to discover accounts from.
       */
      masterNode: BIP32Interface;
      /**
       * The gap limit for address discovery
       * @defaultValue 20
       */
      gapLimit?: number;
      /**
       * The network in which to discover the accounts.
       */
      network: Network;
      /*
       * Callback function called with the account
       * descriptor (external descriptor) of either the wpkh, pkh, or sh(wpkh)
       * script type if they are detected of having been used.
       */
      onAccountUsed?: (account: Account) => void;
    }) {
      const discoveryTasks = [];
      const { pkhBIP32, shWpkhBIP32, wpkhBIP32 } = scriptExpressions;
      for (const expressionFn of [pkhBIP32, shWpkhBIP32, wpkhBIP32]) {
        let accountNumber = 0;
        const next = async () => {
          const expressions = [0, 1].map(change =>
            expressionFn({
              masterNode,
              network,
              account: accountNumber,
              change,
              index: '*'
            })
          );
          const account = expressions[0]!;
          //console.log('STANDARD', { expressions, gapLimit, account });
          accountNumber++;
          const onUsed = onAccountUsed && (() => onAccountUsed(account));
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

    /**
     * Retrieves an array of descriptor expressions associated with a specific
     * network. The result is cached based on the size specified in the constructor.
     * As long as this cache size is not exceeded, this function will maintain
     * the same object reference per networkId if the returned array hasn't changed.
     * This characteristic can be particularly beneficial in
     * React and similar projects, where re-rendering occurs based on reference changes.
     *
     * @param options
     * @returns Returns an array of descriptor expressions.
     * These are derived from the discovery information of the wallet and the
     * provided network.
     *
     */
    getExpressions({
      network
    }: {
      /**
       * The network associated with the descriptors.
       */
      network: Network;
    }): Array<Expression> {
      const networkId = getNetworkId(network);
      return this.#derivers.deriveExpressions(this.discoveryInfo, networkId);
    }

    /**
     * Retrieves all the accounts in the wallet: those descriptors with keyPaths
     * ending in `{/0/*, /1/*}`. An account is identified
     * by its external descriptor `keyPath = /0/*`. The result is cached based on
     * the size specified in the constructor. As long as this cache size is not
     * exceeded, this function will maintain the same object reference per
     * networkId if the returned array remains unchanged.
     * This characteristic can be especially beneficial in
     * React or similar projects, where re-rendering occurs based on reference changes.
     *
     * @param options
     * @returns An array of accounts, each represented
     * as its external descriptor expression.
     */
    getAccounts({
      network
    }: {
      /**
       * The network associated with the descriptors.
       */
      network: Network;
    }): Array<Account> {
      const networkId = getNetworkId(network);
      return this.#derivers.deriveAccounts(this.discoveryInfo, networkId);
    }

    /**
     * Retrieves descriptor expressions associated with a specific account.
     * The result is cached based on the size specified in the constructor.
     * As long as this cache size is not exceeded, this function will maintain
     * the same object reference. This characteristic can be especially
     * beneficial in React or similar projects, where re-rendering occurs based
     * on reference changes.
     *
     * @param options
     * @returns An array of descriptor expressions
     * associated with the specified account.
     */
    getAccountExpressions({
      account
    }: {
      /**
       * The account associated with the descriptors.
       */
      account: Account;
    }): Array<Expression> {
      return this.#derivers.deriveAccountExpressions(account);
    }

    /**
     * Retrieves unspent transaction outputs (UTXOs) and balance associated with
     * a specific scriptPubKey, described by an expression and index within a
     * specified network and transaction status.
     *
     * This method is useful for accessing the available funds for a specific
     * scriptPubKey in the wallet, considering the transaction status
     * (confirmed, unconfirmed, or both).
     *
     * The return value is computed based on the current state of discoveryInfo.
     * The method uses memoization to maintain the same object reference for the
     * returned result, given the same input parameters, as long as the
     * corresponding UTXOs in discoveryInfo haven't changed.
     * This can be useful in environments such as React where
     * preserving object identity can prevent unnecessary re-renders.
     *
     * @param options
     * @returns An object containing the UTXOs associated with the
     * scriptPubKey and the total balance of these UTXOs.
     */
    getUtxosByScriptPubKey({
      expression,
      index,
      network,
      txStatus = TxStatus.ALL
    }: {
      /**
       * The descriptor expression associated with the scriptPubKey.
       */
      expression: Expression;
      /**
       * The descriptor index associated with the scriptPubKey.
       */
      index: DescriptorIndex;
      /**
       * The network associated with the scriptPubKey.
       */
      network: Network;
      /**
       * The transaction status to consider when extracting UTXOs and balance.
       * @defaultValue TxStatus.ALL
       */
      txStatus?: TxStatus;
    }): { utxos: Array<Utxo>; balance: number } {
      expression = canonicalize(expression, network) as string;
      const networkId = getNetworkId(network);
      const descriptors = this.discoveryInfo[networkId].descriptors;
      const txInfoRecords = this.discoveryInfo[networkId].txInfoRecords;
      return this.#derivers.deriveUtxosAndBalanceByScriptPubKey(
        networkId,
        txInfoRecords,
        descriptors,
        expression,
        index,
        txStatus
      );
    }

    /**
     * Retrieves unspent transaction outputs (UTXOs) and balance associated with
     * one or more descriptor expressions within a specified network and
     * transaction status.
     *
     * This method is useful for accessing the available funds for specific
     * descriptor expressions in the wallet, considering the transaction status
     * (confirmed, unconfirmed, or both).
     *
     * The return value is computed based on the current state of discoveryInfo.
     * The method uses memoization to maintain the same object reference for the
     * returned result, given the same input parameters, as long as the
     * corresponding UTXOs in discoveryInfo haven't changed.
     * This can be useful in environments such as React where
     * preserving object identity can prevent unnecessary re-renders.
     *
     * @param options
     * @returns An object containing the UTXOs associated with the
     * scriptPubKeys and the total balance of these UTXOs.
     */
    getUtxos({
      expressions,
      network,
      txStatus = TxStatus.ALL
    }: {
      /**
       * The descriptor expression(s) associated with the scriptPubKeys.
       * Can be a single expression or an array of expressions.
       */
      expressions: Expression | Array<Expression>;
      /**
       * The network associated with the scriptPubKeys.
       */
      network: Network;
      /**
       * The transaction status to consider when extracting UTXOs and balance.
       * @defaultValue TxStatus.ALL
       */
      txStatus?: TxStatus;
    }): { utxos: Array<Utxo>; balance: number } {
      expressions = canonicalize(expressions, network);
      const networkId = getNetworkId(network);
      const descriptors = this.discoveryInfo[networkId].descriptors;
      const txInfoRecords = this.discoveryInfo[networkId].txInfoRecords;
      return this.#derivers.deriveUtxosAndBalanceByExpressions(
        networkId,
        txInfoRecords,
        descriptors,
        expressions,
        txStatus
      );
    }

    /**
     * Retrieves the next available index for a given account within a specified network.
     *
     * The index can be either for the external or internal keys within the account.
     * External keys are used for receiving funds, while internal keys
     * are used for change outputs in transactions.
     *
     * The method retrieves the currently highest index used for the respective key type
     * (external or internal), and returns the next available index by incrementing it by 1.
     *
     * @param options
     * @returns The next available index for the specified key type within the account.
     */
    getNextIndex({
      network,
      account,
      isExternal = true,
      txStatus = TxStatus.ALL
    }: {
      /**
       * The network associated with the account.
       */
      network: Network;
      /**
       * The account for which to retrieve the next available index.
       */
      account: Account;
      /**
       * If true, returns the next index for an external key.
       * If false, returns the next index for an internal key.
       * Defaults to true if not provided.
       * @defaultValue true
       */
      isExternal: boolean;
      /**
       * A scriptPubKey will be considered as used when
       * its transaction status is txStatus
       * extracting UTXOs and balance.
       * @defaultValue TxStatus.ALL
       */
      txStatus?: TxStatus;
    }) {
      const expressions = this.#derivers.deriveAccountExpressions(account);
      const expression = isExternal === true ? expressions[0] : expressions[1];
      if (!expression) throw new Error(`Could not retrieve a valid expression`);

      const networkId = getNetworkId(network);
      const descriptors = this.discoveryInfo[networkId].descriptors;
      const txInfoRecords = this.discoveryInfo[networkId].txInfoRecords;
      let index = 0;
      while (
        this.#derivers.deriveHistoryByScriptPubKey(
          txInfoRecords,
          descriptors,
          expression,
          index,
          txStatus
        ).length
      )
        index++;
      return index;
    }

    /**
     * Retrieves the transaction history for a specific script public key.
     *
     * This method is useful for fetching transaction records associated with a specific
     * script public key within a specified network and transaction status.
     *
     * The return value is computed based on the current state of discoveryInfo. The method
     * uses memoization to maintain the same object reference for the returned result, given
     * the same input parameters, as long as the corresponding transaction records in
     * discoveryInfo haven't changed.
     *
     * This can be useful in environments such as React where preserving object identity can
     * prevent unnecessary re-renders.
     *
     * @param options
     * @returns An array containing transaction info associated with the script public key.
     */
    getHistoryByScriptPubKey({
      expression,
      index,
      network,
      txStatus = TxStatus.ALL
    }: {
      /**
       * The descriptor expression.
       */
      expression: Expression;
      /**
       * The index in the descriptor.
       */
      index: DescriptorIndex;
      /**
       * The network associated with the scriptPubKey.
       */
      network: Network;
      /**
       * The transaction status to consider when fetching transaction history.
       * @defaultValue TxStatus.ALL
       */
      txStatus?: TxStatus;
    }): Array<TxInfo> {
      expression = canonicalize(expression, network) as string;
      const networkId = getNetworkId(network);
      const descriptors = this.discoveryInfo[networkId].descriptors;
      const txInfoRecords = this.discoveryInfo[networkId].txInfoRecords;
      return this.#derivers.deriveHistoryByScriptPubKey(
        txInfoRecords,
        descriptors,
        expression,
        index,
        txStatus
      );
    }

    /**
     * Retrieves the transaction history for one or more descriptor expressions.
     *
     * This method is useful for accessing transaction records associated with one or more
     * descriptor expressions within a specified network and transaction status.
     *
     * The return value is computed based on the current state of discoveryInfo. The method
     * uses memoization to maintain the same object reference for the returned result, given
     * the same input parameters, as long as the corresponding transaction records in
     * discoveryInfo haven't changed.
     *
     * This can be useful in environments such as React where preserving object identity can
     * prevent unnecessary re-renders.
     *
     * @param options
     * @returns An array containing transaction info associated with the descriptor expressions.
     */
    getHistory({
      expressions,
      network,
      txStatus = TxStatus.ALL
    }: {
      /**
       * One or more descriptor expressions.
       */
      expressions: Expression | Array<Expression>;
      /**
       * The network associated with the descriptor expressions.
       */
      network: Network;
      /**
       * The transaction status to consider when fetching transaction history.
       * @defaultValue TxStatus.ALL
       */
      txStatus?: TxStatus;
    }): Array<TxInfo> {
      expressions = canonicalize(expressions, network);
      const networkId = getNetworkId(network);
      const descriptors = this.discoveryInfo[networkId].descriptors;
      const txInfoRecords = this.discoveryInfo[networkId].txInfoRecords;
      return this.#derivers.deriveHistory(
        txInfoRecords,
        descriptors,
        expressions,
        txStatus
      );
    }

    /**
     * Retrieves the hexadecimal representation of a transaction (TxHex) from the
     * discoveryInfo given the transaction ID (TxId) or a Unspent Transaction Output (Utxo)
     * as well as the network in which the transaction occurred.
     *
     * @param options
     * @returns The hexadecimal representation of the transaction.
     * @throws Will throw an error if the transaction ID is invalid or if the TxHex is not found.
     */
    getTxHex({
      network,
      tx
    }: {
      /**
       * The network where the transaction took place.
       */
      network: Network;
      /**
       * The transaction ID or a UTXO.
       */
      tx: TxId | Utxo;
    }): TxHex {
      const networkId = getNetworkId(network);
      const txId = tx.indexOf(':') === -1 ? tx : tx.split(':')[0];
      if (!txId) throw new Error(`Error: invalid tx`);
      const txHex = this.discoveryInfo[networkId].txInfoRecords[txId]?.txHex;
      if (!txHex) throw new Error(`Error: txHex not found`);
      return txHex;
    }

    /**
     * Retrieves the transaction data as a Transaction object given the transaction
     * ID (TxId) or a Unspent Transaction Output (Utxo) and the network in which
     * the transaction occurred. The transaction data is obtained by first getting
     * the transaction hexadecimal representation using getTxHex() method.
     *
     * Use this method for quick access to the Transaction object, which avoids the
     * need to parse the transaction hexadecimal representation (txHex).
     * The data will have already been computed and cached for efficiency within
     * the Discovery class.
     *
     * @param options
     * @returns The transaction data as a Transaction object.
     */
    getTransaction({
      network,
      tx
    }: {
      /**
       * The network where the transaction took place.
       */
      network: Network;
      /**
       * The transaction ID or a UTXO.
       */
      tx: TxId | Utxo;
    }): Transaction {
      const txHex = this.getTxHex({ network, tx });
      return this.#derivers.transactionFromHex(txHex);
    }

    /**
     * Retrieves the current state of discovery information. This information
     * includes details about transactions, descriptors, and network-specific
     * details that are stored during the wallet discovery process.
     *
     * @returns The current state of the discovery information.
     */
    getDiscoveryInfo() {
      return this.discoveryInfo;
    }
  }
  return { Discovery };
}

/**
 * The {@link DiscoveryFactory | `DiscoveryFactory`} function internally creates and returns the {@link _Internal_.Discovery | `Discovery`} class.
 * This class is specialized for the provided `Explorer`, which is responsible for fetching blockchain data like transaction details.
 * Use `DiscoveryInstance` to declare instances for this class: `const: DiscoveryInstance = new Discovery();`
 *
 * See the {@link _Internal_.Discovery | documentation for the internal Discovery class} for a complete list of available methods.
 */

type DiscoveryInstance = InstanceType<
  ReturnType<typeof DiscoveryFactory>['Discovery']
>;

export { DiscoveryInstance };
