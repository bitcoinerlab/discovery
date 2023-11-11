// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

//TODO: Important to emphasize that we don't allow different descritptors for
//the same output

import { produce } from 'immer';
import { shallowEqualArrays } from 'shallow-equal';

import { canonicalize, deriveDataFactory } from './deriveData';

import { getNetworkId } from './networks';

import { scriptExpressions } from '@bitcoinerlab/descriptors';

import { Network, crypto, Transaction } from 'bitcoinjs-lib';
import type { BIP32Interface } from 'bip32';
import type { Explorer } from '@bitcoinerlab/explorer';

import {
  OutputCriteria,
  NetworkId,
  TxId,
  TxHex,
  TxData,
  OutputData,
  Descriptor,
  Account,
  DescriptorIndex,
  DescriptorData,
  NetworkData,
  DiscoveryData,
  Utxo,
  TxStatus
} from './types';

const now = () => Math.floor(Date.now() / 1000);

/**
 * Creates and returns a Discovery class for discovering funds in a Bitcoin network
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
  explorer: Explorer,
  /**
   * The Bitcoin network to use.
   * One of bitcoinjs-lib [`networks`](https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/src/networks.js) (or another one following the same interface).
   */
  network: Network
) {
  /**
   * A class to discover funds in a Bitcoin network using descriptors.
   * The {@link DiscoveryFactory | `DiscoveryFactory`} function internally creates and returns an instance of this class.
   * The returned class is specialized for the provided `Explorer`, which is responsible for fetching blockchain data like transaction details.
   */
  class Discovery {
    #derivers: ReturnType<typeof deriveDataFactory>;
    #discoveryData: DiscoveryData;

    /**
     * Constructs a Discovery instance. Discovery is used to discover funds
     * in a Bitcoin network using descriptors.
     *
     * @param options
     */
    constructor(
      {
        descriptorsCacheSize = 1000,
        outputsPerDescriptorCacheSize = 10000
      }: {
        /**
         * Cache size limit for descriptor expressions.
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
        descriptorsCacheSize: number;
        /**
         * Cache size limit for outputs per descriptor, related to the number of outputs
         * in ranged descriptor expressions. Similar to the `descriptorsCacheSize`,
         * this cache is used to speed up data queries and avoid recomputations.
         * As each descriptor can have multiple indices (if ranged), the number of outputs can grow rapidly,
         * leading to increased memory usage. Setting a limit helps keep memory usage in check,
         * while also maintaining the benefits of immutability and computational efficiency.
         * Set to 0 for unbounded caches.
         * @defaultValue 10000
         */
        outputsPerDescriptorCacheSize: number;
      } = {
        descriptorsCacheSize: 1000,
        outputsPerDescriptorCacheSize: 10000
      }
    ) {
      this.#discoveryData = {} as DiscoveryData;
      for (const networkId of Object.values(NetworkId)) {
        const txMap: Record<TxId, TxData> = {};
        const descriptorMap: Record<Descriptor, DescriptorData> = {};
        const networkData: NetworkData = {
          descriptorMap,
          txMap
        };
        this.#discoveryData[networkId] = networkData;
      }
      this.#derivers = deriveDataFactory({
        descriptorsCacheSize,
        outputsPerDescriptorCacheSize
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
      const descriptorMap = this.#discoveryData[networkId].descriptorMap;
      const descriptors = this.#derivers.deriveUsedDescriptors(
        this.#discoveryData,
        networkId
      );
      descriptors.forEach(descriptor => {
        const range =
          descriptorMap[descriptor]?.range ||
          ({} as Record<DescriptorIndex, OutputData>);

        Object.keys(range).forEach(indexStr => {
          const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
          if (
            scriptPubKey.equals(
              this.#derivers.deriveScriptPubKey(networkId, descriptor, index) //This will be very fast (uses memoization)
            )
          ) {
            throw new Error(
              `The provided scriptPubKey is already set: ${descriptor}, ${index}.`
            );
          }
        });
      });
    }

    /**
     * Asynchronously discovers an output, given a descriptor expression and
     * index. It first retrieves the output,
     * computes its scriptHash, and fetches the transaction history associated
     * with this scriptHash from the explorer. It then updates the internal
     * discoveryData accordingly.
     *
     * This function has side-effects as it modifies the internal discoveryData
     * state of the Discovery class instance. This state keeps track of
     * transaction info and descriptors relevant to the discovery process.
     *
     * This method is useful for updating the state based on new
     * transactions and output.
     *
     * This method does not retrieve the txHex associated with the Output.
     * An additional #fetchTxs must be performed.
     *
     * @param options
     * @returns A promise that resolves to a boolean indicating whether any transactions were found for the provided scriptPubKey.
     */
    async #fetchOutput({
      descriptor,
      index
    }: {
      /**
       * The descriptor expression associated with the scriptPubKey to discover.
       */
      descriptor: Descriptor;
      /**
       * The descriptor index associated with the scriptPubKey to discover (if ranged).
       */
      index?: number;
    }): Promise<boolean> {
      if (
        (typeof index !== 'undefined' && descriptor.indexOf('*') === -1) ||
        (typeof index === 'undefined' && descriptor.indexOf('*') !== -1)
      )
        throw new Error(`Pass index for ranged descriptors`);
      const internalIndex = typeof index === 'number' ? index : 'non-ranged';
      const networkId = getNetworkId(network);
      const scriptPubKey = this.#derivers.deriveScriptPubKey(
        networkId,
        canonicalize(descriptor, network) as string,
        internalIndex
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
      this.#discoveryData = produce(this.#discoveryData, discoveryData => {
        const range = discoveryData[networkId].descriptorMap[descriptor]?.range;
        if (!range) throw new Error(`unset range ${networkId}:${descriptor}`);
        const outputData = range[internalIndex];
        if (!outputData) {
          this.#ensureScriptPubKeyUniqueness({ networkId, scriptPubKey });
          range[internalIndex] = { txIds: [], fetching: true, timeFetched: 0 };
        } else outputData.fetching = true;
      });

      const txHistoryArray: Array<TxHistory> = await explorer.fetchTxHistory({
        scriptHash
      });
      //console.log('TRACE', { scriptHash, txHistoryArray });

      this.#discoveryData = produce(this.#discoveryData, discoveryData => {
        // Update txMap
        const txMap = discoveryData[networkId].txMap;
        txHistoryArray.forEach(({ txId, irreversible, blockHeight }) => {
          const txData = txMap[txId];
          if (!txData) {
            txMap[txId] = { irreversible, blockHeight };
          } else {
            txData.irreversible = irreversible;
            txData.blockHeight = blockHeight;
          }
        });
        //Update descriptorMap
        const range = discoveryData[networkId].descriptorMap[descriptor]?.range;
        if (!range) throw new Error(`unset range ${networkId}:${descriptor}`);
        const outputData = range[internalIndex];
        if (!outputData) throw new Error(`outputData unset with fetching:true`);
        const txIds = txHistoryArray.map(txHistory => txHistory.txId);
        outputData.fetching = false;
        outputData.timeFetched = now();
        if (!shallowEqualArrays(txIds, outputData.txIds))
          outputData.txIds = txIds;
      });
      return !!txHistoryArray.length;
    }

    /**
     * Asynchronously fetches all raw transaction data from all transactions
     * associated with all the outputs fetched.
     *
     * @param options
     * @returns Resolves when all the transactions have been fetched and stored in discoveryData.
     */
    async #fetchTxs() {
      const txHexRecords: Record<TxId, TxHex> = {};
      const networkId = getNetworkId(network);
      const networkData = this.#discoveryData[networkId];
      for (const descriptor in networkData.descriptorMap) {
        const range = networkData.descriptorMap[descriptor]?.range || [];
        for (const index in range) {
          const txIds = range[index]?.txIds;
          if (!txIds)
            throw new Error(
              `Error: cannot retrieve txs for nonexising scriptPubKey: ${networkId}, ${descriptor}, ${index}`
            );
          for (const txId of txIds)
            if (!networkData.txMap[txId]?.txHex)
              txHexRecords[txId] = await explorer.fetchTx(txId);
        }
      }
      if (Object.keys(txHexRecords).length) {
        this.#discoveryData = produce(this.#discoveryData, discoveryData => {
          for (const txId in txHexRecords) {
            const txHex = txHexRecords[txId];
            if (!txHex) throw new Error(`txHex not retrieved for ${txId}`);
            const txData = discoveryData[networkId].txMap[txId];
            if (!txData) throw new Error(`txData does not exist for ${txId}`);
            txData.txHex = txHex;
          }
        });
      }
    }

    /**
     * Asynchronously fetches one or more descriptor expressions, retrieving
     * all the historical txs associated with the outputs represented by the
     * expressions.
     *
     * @param options
     * @returns Resolves when the fetch operation completes. If used expressions
     * are found, waits for the discovery of associated transactions.
     */
    async fetch({
      descriptor,
      index,
      descriptors,
      gapLimit = 20,
      onUsed,
      onChecking,
      next
    }: {
      /**
       * Descriptor expression representing one or potentially multiple outputs
       * if ranged.
       * Use either `descriptor` or `descriptors`, but not both simultaneously.
       */
      descriptor?: Descriptor;

      /**
       * An optional index associated with a ranged `descriptor`. Not applicable
       * when using the `descriptors` array, even if its elements are ranged.
       */
      index?: number;

      /**
       * Array of descriptor expressions. Use either `descriptors` or `descriptor`,
       * but not both simultaneously.
       */
      descriptors?: Array<Descriptor>;

      /**
       * The gap limit for the fetch operation when retrieving ranged descriptors.
       * @defaultValue 20
       */
      gapLimit?: number;
      /**
       * Optional callback function triggered once a descriptor's output has been
       * identified as previously used in a transaction. It provides a way to react
       * or perform side effects based on this finding.
       * @param descriptorOrDescriptors - The original descriptor or array of descriptors
       * that have been determined to have a used output.
       */
      onUsed?: (
        descriptorOrDescriptors: Descriptor | Array<Descriptor>
      ) => void;
      /**
       * Optional callback function invoked at the beginning of checking a descriptor
       * to determine its usage status. This can be used to signal the start of a
       * descriptor's check, potentially for logging or UI updates.
       * @param descriptorOrDescriptors - The descriptor or array of descriptors being checked.
       */
      onChecking?: (
        descriptorOrDescriptors: Descriptor | Array<Descriptor>
      ) => void;
      /**
       * Optional function triggered immediately after detecting that a descriptor's output
       * has been used previously. By invoking this function, it's possible to initiate
       * parallel discovery processes. The primary `discover` method will only resolve
       * once both its main discovery process and any supplementary processes initiated
       * by `next` have completed. Essentially, it ensures that all discovery,
       * both primary and secondary, finishes before moving on.
       */
      next?: () => Promise<void>;
    }) {
      const descriptorOrDescriptors = descriptor || descriptors;
      if ((descriptor && descriptors) || !descriptorOrDescriptors)
        throw new Error(`Pass descriptor or descriptors`);
      if (
        typeof index !== 'undefined' &&
        (descriptors || !descriptor?.includes('*'))
      )
        throw new Error(`Don't pass index`);
      if (onChecking) onChecking(descriptorOrDescriptors);
      const canonicalInput = canonicalize(descriptorOrDescriptors, network);
      let nextPromise;
      let usedOutput = false;
      let usedOutputNotified = false;

      const descriptorArray = Array.isArray(canonicalInput)
        ? canonicalInput
        : [canonicalInput];
      const networkId = getNetworkId(network);
      for (const descriptor of descriptorArray) {
        this.#discoveryData = produce(this.#discoveryData, discoveryData => {
          const descriptorInfo =
            discoveryData[networkId].descriptorMap[descriptor];
          if (!descriptorInfo) {
            discoveryData[networkId].descriptorMap[descriptor] = {
              timeFetched: 0,
              fetching: true,
              range: {} as Record<DescriptorIndex, OutputData>
            };
          } else {
            descriptorInfo.fetching = true;
          }
        });

        let gap = 0;
        let indexEvaluated = index || 0; //If it was a passed argument use it; othewise start at zero
        const isRanged = descriptor.indexOf('*') !== -1;
        while (
          isRanged ? gap < gapLimit : indexEvaluated < 1 /*once if unranged*/
        ) {
          const used = await this.#fetchOutput({
            descriptor,
            ...(isRanged ? { index: indexEvaluated } : {})
          });

          if (used) {
            usedOutput = true;
            gap = 0;
          } else gap++;

          if (used && next && !nextPromise) nextPromise = next();

          indexEvaluated++;

          if (used && onUsed && usedOutputNotified === false) {
            onUsed(descriptorOrDescriptors);
            usedOutputNotified = true;
          }
        }
        this.#discoveryData = produce(this.#discoveryData, discoveryData => {
          const descriptorInfo =
            discoveryData[networkId].descriptorMap[descriptor];
          if (!descriptorInfo)
            throw new Error(
              `Descriptor for ${networkId} and ${descriptor} does not exist`
            );
          descriptorInfo.fetching = false;
          descriptorInfo.timeFetched = now();
        });
      }

      const promises = [];
      if (usedOutput) promises.push(this.#fetchTxs());
      if (nextPromise) promises.push(nextPromise);
      await Promise.all(promises);
    }

    /**
     * Retrieves the fetching status and the timestamp of the last fetch for a descriptor.
     *
     * Use this function to check if the data for a specific descriptor, or an index within
     * a ranged descriptor, is currently being fetched or has been fetched.
     *
     * This function also helps to avoid errors when attempting to derive data from descriptors with incomplete data,
     * ensuring that subsequent calls to data derivation methods such as `getUtxos` or
     * `getBalance` only occur once the necessary data has been successfully retrieved (and does not return `undefined`).
     *
     * @returns An object with the fetching status (`fetching`) and the last
     *          fetch time (`timeFetched`), or undefined if never fetched.
     */
    whenFetched({
      descriptor,
      index
    }: {
      /**
       * Descriptor expression representing one or potentially multiple outputs
       * if ranged.
       */
      descriptor: Descriptor;

      /**
       * An optional index associated with a ranged `descriptor`.
       */
      index?: number;
    }): { fetching: boolean; timeFetched: number } | undefined {
      if (typeof index !== 'undefined' && descriptor.indexOf('*') === -1)
        throw new Error(`Pass index (optionally) only for ranged descriptors`);
      const networkId = getNetworkId(network);
      const descriptorData =
        this.#discoveryData[networkId].descriptorMap[descriptor];
      if (!descriptorData) return undefined;
      if (typeof index !== 'number') {
        return {
          fetching: descriptorData.fetching,
          timeFetched: descriptorData.timeFetched
        };
      } else {
        const internalIndex = typeof index === 'number' ? index : 'non-ranged';
        const outputData = descriptorData.range[internalIndex];
        if (!outputData) return undefined;
        else
          return {
            fetching: outputData.fetching,
            timeFetched: outputData.timeFetched
          };
      }
    }

    /**
     * Makes sure that data was retrieved before trying to derive from it
     */
    #ensureFetched({
      descriptor,
      index,
      descriptors
    }: {
      /**
       * Descriptor expression representing one or potentially multiple outputs
       * if ranged.
       * Use either `descriptor` or `descriptors`, but not both simultaneously.
       */
      descriptor?: Descriptor;

      /**
       * An optional index associated with a ranged `descriptor`. Not applicable
       * when using the `descriptors` array, even if its elements are ranged.
       */
      index?: number;

      /**
       * Array of descriptor expressions. Use either `descriptors` or `descriptor`,
       * but not both simultaneously.
       */
      descriptors?: Array<Descriptor>;
    }) {
      if ((descriptor && descriptors) || !(descriptor || descriptors))
        throw new Error(`Pass descriptor or descriptors`);
      if (
        typeof index !== 'undefined' &&
        (descriptors || !descriptor?.includes('*'))
      )
        throw new Error(`Don't pass index`);
      if (descriptors)
        descriptors.forEach(descriptor => {
          if (!this.whenFetched({ descriptor }))
            throw new Error(
              `Cannot derive data from ${descriptor} since it has not been previously fetched`
            );
        });
      else if (
        descriptor &&
        !this.whenFetched({ descriptor, ...(index ? { index } : {}) })
      )
        throw new Error(
          `Cannot derive data from ${descriptor}/${index} since it has not been previously fetched`
        );
    }

    /**
     * Asynchronously discovers standard accounts (pkh, sh(wpkh), wpkh) associated
     * with a master node. It uses a given gap limit for
     * discovery.
     *
     * @param options
     * @returns Resolves when all the standrd accounts from the master node have
     * been discovered.
     */
    async fetchStandardAccounts({
      masterNode,
      gapLimit = 20,
      onAccountUsed,
      onAccountChecking
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
       * Optional callback function triggered when an {@link Account account}
       * (associated with the master node) has been identified as having past
       * transactions. It's called with the external descriptor
       * of the account (`keyPath = /0/*`) that is active.
       *
       * @param account - The external descriptor of the account that has been determined to have prior transaction activity.
       */
      onAccountUsed?: (account: Account) => void;
      /**
       * Optional callback function invoked just as the system starts to evaluate the transaction
       * activity of an {@link Account account} (associated with the master node).
       * Useful for signaling the initiation of the discovery process for a
       * particular account, often for UI updates or logging purposes.
       *
       * @param account - The external descriptor of the account that is currently being evaluated for transaction activity.
       */
      onAccountChecking?: (account: Account) => void;
    }) {
      const discoveryTasks = [];
      const { pkhBIP32, shWpkhBIP32, wpkhBIP32 } = scriptExpressions;
      if (!masterNode) throw new Error(`Error: provide a masterNode`);
      for (const expressionFn of [pkhBIP32, shWpkhBIP32, wpkhBIP32]) {
        let accountNumber = 0;
        const next = async () => {
          const descriptors = [0, 1].map(change =>
            expressionFn({
              masterNode,
              network,
              account: accountNumber,
              change,
              index: '*'
            })
          );
          const account = descriptors[0]!;
          //console.log('STANDARD', { descriptors, gapLimit, account });
          accountNumber++;
          const onUsed = onAccountUsed && (() => onAccountUsed(account));
          const onChecking =
            onAccountChecking && (() => onAccountChecking(account));
          await this.fetch({
            descriptors,
            gapLimit,
            next,
            ...(onUsed ? { onUsed } : {}),
            ...(onChecking ? { onChecking } : {})
          });
        };
        discoveryTasks.push(next());
      }
      await Promise.all(discoveryTasks);
    }

    /**
     * Retrieves the array of descriptors with used outputs.
     * The result is cached based on the size specified in the constructor.
     * As long as this cache size is not exceeded, this function will maintain
     * the same object reference if the returned array hasn't changed.
     * This characteristic can be particularly beneficial in
     * React and similar projects, where re-rendering occurs based on reference changes.
     *
     * @param options
     * @returns Returns an array of descriptor expressions.
     * These are derived from the discovery information.
     *
     */
    getUsedDescriptors(): Array<Descriptor> {
      const networkId = getNetworkId(network);
      return this.#derivers.deriveUsedDescriptors(
        this.#discoveryData,
        networkId
      );
    }

    /**
     * Retrieves all the {@link Account accounts} with used outputs:
     * those descriptors with keyPaths ending in `{/0/*, /1/*}`. An account is identified
     * by its external descriptor `keyPath = /0/*`. The result is cached based on
     * the size specified in the constructor. As long as this cache size is not
     * exceeded, this function will maintain the same object reference if the returned array remains unchanged.
     * This characteristic can be especially beneficial in
     * React or similar projects, where re-rendering occurs based on reference changes.
     *
     * @param options
     * @returns An array of accounts, each represented
     * as its external descriptor expression.
     */
    getUsedAccounts(): Array<Account> {
      const networkId = getNetworkId(network);
      return this.#derivers.deriveUsedAccounts(this.#discoveryData, networkId);
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
    getAccountDescriptors({
      account
    }: {
      /**
       * The {@link Account account} associated with the descriptors.
       */
      account: Account;
    }): [Descriptor, Descriptor] {
      return this.#derivers.deriveAccountDescriptors(account);
    }

    /**
     * Retrieves unspent transaction outputs (UTXOs) and balance associated with
     * one or more descriptor expressions and transaction status.
     *
     * This method is useful for accessing the available funds for specific
     * descriptor expressions in the wallet, considering the transaction status
     * (confirmed, unconfirmed, or both).
     *
     * The return value is computed based on the current state of discoveryData.
     * The method uses memoization to maintain the same object reference for the
     * returned result, given the same input parameters, as long as the
     * corresponding UTXOs in discoveryData haven't changed.
     * This can be useful in environments such as React where
     * preserving object identity can prevent unnecessary re-renders.
     *
     * @param outputCriteria
     * @returns An object containing the UTXOs associated with the
     * scriptPubKeys and the total balance of these UTXOs.
     */
    getUtxosAndBalance({
      descriptor,
      index,
      descriptors,
      txStatus = TxStatus.ALL
    }: OutputCriteria): { utxos: Array<Utxo>; balance: number } {
      this.#ensureFetched({
        ...(descriptor ? { descriptor } : {}),
        ...(descriptors ? { descriptors } : {}),
        ...(index ? { index } : {})
      });
      if ((descriptor && descriptors) || !(descriptor || descriptors))
        throw new Error(`Pass descriptor or descriptors`);
      if (
        typeof index !== 'undefined' &&
        (descriptors || !descriptor?.includes('*'))
      )
        throw new Error(`Don't pass index`);
      const descriptorOrDescriptors = canonicalize(
        (descriptor || descriptors)!,
        network
      );
      const networkId = getNetworkId(network);
      const descriptorMap = this.#discoveryData[networkId].descriptorMap;
      const txMap = this.#discoveryData[networkId].txMap;

      if (
        descriptor &&
        (typeof index !== 'undefined' || !descriptor.includes('*'))
      ) {
        const internalIndex = typeof index === 'number' ? index : 'non-ranged';
        const txMap = this.#discoveryData[networkId].txMap;
        return this.#derivers.deriveUtxosAndBalanceByOutput(
          networkId,
          txMap,
          descriptorMap,
          descriptorOrDescriptors as string,
          internalIndex,
          txStatus
        );
      } else
        return this.#derivers.deriveUtxosAndBalance(
          networkId,
          txMap,
          descriptorMap,
          descriptorOrDescriptors,
          txStatus
        );
    }

    /**
     * Convenience function which internally invokes the
     * `getUtxosAndBalance(options).balance` method.
     */
    getBalance(outputCriteria: OutputCriteria): number {
      return this.getUtxosAndBalance(outputCriteria).balance;
    }

    /**
     * Convenience function which internally invokes the
     * `getUtxosAndBalance(options).utxos` method.
     */
    getUtxos(outputCriteria: OutputCriteria): Array<Utxo> {
      return this.getUtxosAndBalance(outputCriteria).utxos;
    }

    /**
     * Retrieves the next available index for a given descriptor.
     *
     * The method retrieves the currently highest index used, and returns the
     * next available index by incrementing it by 1.
     *
     * @param options
     * @returns The next available index.
     */
    getNextIndex({
      descriptor,
      txStatus = TxStatus.ALL
    }: {
      /**
       * The ranged descriptor expression for which to retrieve the next
       * available index.
       */
      descriptor: Descriptor;
      /**
       * A scriptPubKey will be considered as used when
       * its transaction status is txStatus
       * extracting UTXOs and balance.
       * @defaultValue TxStatus.ALL
       */
      txStatus?: TxStatus;
    }) {
      if (!descriptor || descriptor.indexOf('*') === -1)
        throw new Error(`Error: invalid ranged descriptor: ${descriptor}`);
      this.#ensureFetched({ descriptor });

      const networkId = getNetworkId(network);
      const descriptorMap = this.#discoveryData[networkId].descriptorMap;
      const txMap = this.#discoveryData[networkId].txMap;
      let index = 0;
      while (
        this.#derivers.deriveHistoryByOutput(
          txMap,
          descriptorMap,
          descriptor,
          index,
          txStatus
        ).length
      )
        index++;
      return index;
    }

    /**
     * Retrieves the transaction history for one or more descriptor expressions.
     *
     * This method is useful for accessing transaction records associated with one or more
     * descriptor expressions and transaction status.
     *
     * The return value is computed based on the current state of discoveryData. The method
     * uses memoization to maintain the same object reference for the returned result, given
     * the same input parameters, as long as the corresponding transaction records in
     * discoveryData haven't changed.
     *
     * This can be useful in environments such as React where preserving object identity can
     * prevent unnecessary re-renders.
     *
     * @param outputCriteria
     * @returns An array containing transaction info associated with the descriptor expressions.
     */
    getHistory({
      descriptor,
      index,
      descriptors,
      txStatus = TxStatus.ALL
    }: OutputCriteria): Array<TxData> {
      if ((descriptor && descriptors) || !(descriptor || descriptors))
        throw new Error(`Pass descriptor or descriptors`);
      if (
        typeof index !== 'undefined' &&
        (descriptors || !descriptor?.includes('*'))
      )
        throw new Error(`Don't pass index`);
      const descriptorOrDescriptors = canonicalize(
        (descriptor || descriptors)!,
        network
      );
      this.#ensureFetched({
        ...(descriptor ? { descriptor } : {}),
        ...(descriptors ? { descriptors } : {}),
        ...(index ? { index } : {})
      });
      const networkId = getNetworkId(network);
      const descriptorMap = this.#discoveryData[networkId].descriptorMap;
      const txMap = this.#discoveryData[networkId].txMap;

      if (
        descriptor &&
        (typeof index !== 'undefined' || !descriptor.includes('*'))
      ) {
        const internalIndex = typeof index === 'number' ? index : 'non-ranged';
        return this.#derivers.deriveHistoryByOutput(
          txMap,
          descriptorMap,
          descriptorOrDescriptors as string,
          internalIndex,
          txStatus
        );
      } else
        return this.#derivers.deriveHistory(
          txMap,
          descriptorMap,
          descriptorOrDescriptors,
          txStatus
        );
    }

    /**
     * Retrieves the hexadecimal representation of a transaction (TxHex) from the
     * discoveryData given the transaction ID (TxId) or a Unspent Transaction Output (Utxo)
     *
     * @param options
     * @returns The hexadecimal representation of the transaction.
     * @throws Will throw an error if the transaction ID is invalid or if the TxHex is not found.
     */
    getTxHex({
      txId,
      utxo
    }: {
      /**
       * The transaction ID.
       */
      txId?: TxId;
      /**
       * The UTXO.
       */
      utxo?: Utxo;
    }): TxHex {
      if ((txId && utxo) || (!txId && !utxo)) {
        throw new Error(
          `Error: Please provide either a txId or a utxo, not both or neither.`
        );
      }
      const networkId = getNetworkId(network);
      txId = utxo ? utxo.split(':')[0] : txId;
      if (!txId) throw new Error(`Error: invalid input`);
      const txHex = this.#discoveryData[networkId].txMap[txId]?.txHex;
      if (!txHex) throw new Error(`Error: txHex not found`);
      return txHex;
    }

    /**
     * Retrieves the transaction data as a bitcoinjs-lib
     * {@link https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/ts_src/transaction.ts Transaction}
     * object given the transaction
     * ID (TxId) or a Unspent Transaction Output (Utxo). The transaction data is obtained by first getting
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
      txId,
      utxo
    }: {
      /**
       * The transaction ID.
       */
      txId?: TxId;
      /**
       * The UTXO.
       */
      utxo?: Utxo;
    }): Transaction {
      const txHex = this.getTxHex({
        ...(utxo ? { utxo } : {}),
        ...(txId ? { txId } : {})
      });
      return this.#derivers.transactionFromHex(txHex);
    }

    /**
     * Given an unspent tx output, this function retrieves its descriptor.
     */
    getDescriptor({
      utxo
    }: {
      /**
       * The UTXO.
       */
      utxo: Utxo;
    }):
      | {
          descriptor: Descriptor;
          index?: number;
        }
      | undefined {
      const networkId = getNetworkId(network);
      const split = utxo.split(':');
      if (split.length !== 2) throw new Error(`Error: invalid utxo: ${utxo}`);
      const txId = split[0];
      if (!txId) throw new Error(`Error: invalid utxo: ${utxo}`);
      const strVout = split[1];
      if (!strVout) throw new Error(`Error: invalid utxo: ${utxo}`);
      const vout = parseInt(strVout);
      if (vout.toString() !== strVout)
        throw new Error(`Error: invalid utxo: ${utxo}`);
      const txHex = this.#discoveryData[networkId].txMap[txId]?.txHex;
      if (!txHex) throw new Error(`Error: txHex not found for ${utxo}`);

      const descriptorMap = this.#discoveryData[networkId].descriptorMap;
      const descriptors = this.#derivers.deriveUsedDescriptors(
        this.#discoveryData,
        networkId
      );
      let output:
        | {
            descriptor: Descriptor;
            index?: number;
          }
        | undefined;
      descriptors.forEach(descriptor => {
        const range =
          descriptorMap[descriptor]?.range ||
          ({} as Record<DescriptorIndex, OutputData>);

        Object.keys(range).forEach(indexStr => {
          const isRanged = indexStr !== 'non-ranged';
          const index = isRanged && Number(indexStr);
          if (
            this.getUtxosAndBalance({
              descriptor,
              ...(isRanged ? { index: Number(indexStr) } : {})
            }).utxos.includes(utxo)
          ) {
            if (output)
              throw new Error(
                `output {${descriptor}, ${index}} is already represented by {${output.descriptor}, ${output.index}} .`
              );
            output = {
              descriptor,
              ...(isRanged ? { index: Number(indexStr) } : {})
            };
          }
        });
      });
      return output;
    }

    /**
     * Retrieves the Explorer instance.
     *
     * @returns The Explorer instance.
     */
    getExplorer(): Explorer {
      return explorer;
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
