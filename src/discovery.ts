// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

const DEFAULT_GAP_LIMIT = 20;

import { produce } from 'immer';
import { shallowEqualArrays } from 'shallow-equal';

import { canonicalize, deriveDataFactory } from './deriveData';

import { getNetworkId } from './networks';

import { scriptExpressions } from '@bitcoinerlab/descriptors';

import { Network, crypto, Transaction } from 'bitcoinjs-lib';
import type { BIP32Interface } from 'bip32';
import type { Explorer } from '@bitcoinerlab/explorer';
import cloneDeep from 'lodash.clonedeep';

import {
  DATA_MODEL_VERSION,
  OutputCriteria,
  NetworkId,
  TxId,
  TxData,
  OutputData,
  Descriptor,
  Account,
  DescriptorIndex,
  DescriptorData,
  NetworkData,
  DiscoveryData,
  Utxo,
  TxStatus,
  Stxo,
  TxHex,
  TxAttribution,
  TxWithOrder,
  TxoMap,
  Txo
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
        outputsPerDescriptorCacheSize = 10000,
        imported
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
        descriptorsCacheSize?: number;
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
        outputsPerDescriptorCacheSize?: number;
        /**
         * Optional parameter used to initialize the Discovery instance with
         * previously exported data with
         * {@link _Internal_.Discovery.export | `export()`}. This allows for the
         * continuation of a previous discovery process. The `imported` object
         * should contain `discoveryData` and a `version` string. The
         * `discoveryData` is deeply cloned upon import to ensure that the
         * internal state of the Discovery instance is isolated from
         * external changes. The `version` is used to verify that the imported
         * data model is compatible with the current version of the Discovery
         * class.
         */
        imported?: {
          discoveryData: DiscoveryData;
          version: string;
        };
      } = {
        descriptorsCacheSize: 1000,
        outputsPerDescriptorCacheSize: 10000
      }
    ) {
      if (imported) {
        if (imported.version !== DATA_MODEL_VERSION)
          throw new Error(
            `Cannot import data model. ${imported.version} != ${DATA_MODEL_VERSION}`
          );
        this.#discoveryData = cloneDeep(imported.discoveryData);
      } else {
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
      }
      this.#derivers = deriveDataFactory({
        descriptorsCacheSize,
        outputsPerDescriptorCacheSize
      });
    }

    /**
     * Finds the descriptor (and index) that corresponds to the scriptPubKey
     * passed as argument.
     * @private
     * @param options
     */
    #getDescriptorByScriptPubKey({
      networkId,
      scriptPubKey,
      gapLimit = 0
    }: {
      /**
       * Network to check.
       */
      networkId: NetworkId;
      /**
       * The scriptPubKey to check for uniqueness.
       */
      scriptPubKey: Buffer;
      /**
       * When the descriptor is ranged, it will keep searching for the scriptPubKey
       * to non-set indices above the last one set until reaching the gapLimit.
       * If you only need to get one of the existing already-fetched descriptors,
       * leave gapLimit to zero.
       */
      gapLimit?: number;
    }): { descriptor: Descriptor; index: DescriptorIndex } | undefined {
      const descriptorMap = this.#discoveryData[networkId].descriptorMap;
      const descriptors = Object.keys(descriptorMap);
      for (const descriptor of descriptors) {
        const range =
          descriptorMap[descriptor]?.range ||
          ({} as Record<DescriptorIndex, OutputData>);

        let maxUsedIndex: DescriptorIndex = -1;
        for (const indexStr of Object.keys(range)) {
          const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
          if (
            scriptPubKey.equals(
              this.#derivers.deriveScriptPubKey(networkId, descriptor, index) //This will be very fast (uses memoization)
            )
          ) {
            return { descriptor, index };
          }
          if (typeof index === 'number') {
            if (maxUsedIndex === 'non-ranged')
              throw new Error('maxUsedIndex shoulnt be set as non-ranged');
            if (index > maxUsedIndex && range[index]?.txIds.length)
              maxUsedIndex = index;
          }
          if (index === 'non-ranged') maxUsedIndex = index;
        }
        if (maxUsedIndex !== 'non-ranged' && gapLimit) {
          for (
            let index = maxUsedIndex + 1;
            index < maxUsedIndex + 1 + gapLimit;
            index++
          ) {
            if (
              scriptPubKey.equals(
                this.#derivers.deriveScriptPubKey(networkId, descriptor, index) //This will be very fast (uses memoization)
              )
            ) {
              return { descriptor, index };
            }
          }
        }
      }
      return; //not found
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
      const descriptorWithIndex = this.#getDescriptorByScriptPubKey({
        networkId,
        scriptPubKey
      });
      if (descriptorWithIndex)
        throw new Error(
          `The provided scriptPubKey is already set: ${descriptorWithIndex.descriptor}, ${descriptorWithIndex.index}.`
        );
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
      //console.log(`Fetching ${descriptor}, ${internalIndex}`);
      const scriptPubKey = this.#derivers.deriveScriptPubKey(
        networkId,
        descriptor,
        internalIndex
      );
      //https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes
      const scriptHash = Buffer.from(crypto.sha256(scriptPubKey))
        .reverse()
        .toString('hex');
      this.#discoveryData = produce(this.#discoveryData, discoveryData => {
        const range = discoveryData[networkId].descriptorMap[descriptor]?.range;
        if (!range) throw new Error(`unset range ${networkId}:${descriptor}`);
        const outputData = range[internalIndex];
        if (!outputData) {
          //If it has not been set already, search for other descriptor expressions
          //in case the same scriptPubKey already exists and throw if this is the
          //case
          this.#ensureScriptPubKeyUniqueness({ networkId, scriptPubKey });
          range[internalIndex] = { txIds: [], fetching: true, timeFetched: 0 };
        } else outputData.fetching = true;
      });

      const txHistoryArray: Array<{
        txId: string;
        blockHeight: number;
        irreversible: boolean;
      }> = await explorer.fetchTxHistory({
        scriptHash
      });

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
      const networkId = getNetworkId(network);
      const networkData = this.#discoveryData[networkId];

      const fetchTxPromises = [];
      const txIdsToFetch = new Set<TxId>();

      for (const descriptor in networkData.descriptorMap) {
        const range = networkData.descriptorMap[descriptor]?.range || [];
        for (const index in range) {
          const txIds = range[index]?.txIds;
          if (!txIds)
            throw new Error(
              `Error: cannot retrieve txs for nonexisting scriptPubKey: ${networkId}, ${descriptor}, ${index}`
            );

          for (const txId of txIds) {
            if (!networkData.txMap[txId]?.txHex && !txIdsToFetch.has(txId)) {
              txIdsToFetch.add(txId);
              fetchTxPromises.push(
                explorer.fetchTx(txId).then(txHex => ({ txId, txHex }))
              );
            }
          }
        }
      }

      const txHexResults = await Promise.all(fetchTxPromises);

      if (txHexResults.length) {
        this.#discoveryData = produce(this.#discoveryData, discoveryData => {
          txHexResults.forEach(({ txId, txHex }) => {
            if (!txHex) throw new Error(`txHex not retrieved for ${txId}`);
            const txData = discoveryData[networkId].txMap[txId];
            if (!txData) throw new Error(`txData does not exist for ${txId}`);
            txData.txHex = txHex;
          });
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
      gapLimit = DEFAULT_GAP_LIMIT,
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
      let nextPromise: Promise<void> | undefined = undefined;
      let usedOutput = false;
      let usedOutputNotified = false;

      const descriptorArray = Array.isArray(canonicalInput)
        ? canonicalInput
        : [canonicalInput];
      const networkId = getNetworkId(network);

      const descriptorFetchPromises = descriptorArray.map(async descriptor => {
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
        let outputsFetched = 0;
        let indexEvaluated = index || 0; //If it was a passed argument use it; othewise start at zero
        const isRanged = descriptor.indexOf('*') !== -1;
        const isGapSearch = isRanged && typeof index === 'undefined';

        while (isGapSearch ? gap < gapLimit : outputsFetched < 1) {
          //batch-request the remaining outputs until gapLimit:
          const outputsToFetch = isGapSearch ? gapLimit - gap : 1;
          const fetchPromises = [];
          for (let i = 0; i < outputsToFetch; i++) {
            fetchPromises.push(
              this.#fetchOutput({
                descriptor,
                ...(isRanged ? { index: indexEvaluated + i } : {})
              })
            );
          }

          //Promise.all keeps the order in results
          const results = await Promise.all(fetchPromises);

          //Now, evaluate the gap from the batch of results
          for (const used of results) {
            if (used) {
              usedOutput = true;
              gap = 0;
              if (next && !nextPromise) nextPromise = next();
              if (onUsed && usedOutputNotified === false) {
                onUsed(descriptorOrDescriptors);
                usedOutputNotified = true;
              }
            } else {
              gap++;
            }
            indexEvaluated++;
            outputsFetched++;
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
      });
      await Promise.all(descriptorFetchPromises);

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
        this.#discoveryData[networkId].descriptorMap[
          canonicalize(descriptor, network) as Descriptor
        ];
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
     * Makes sure that data was retrieved before trying to derive from it.
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
        !this.whenFetched({
          descriptor,
          ...(index !== undefined ? { index } : {})
        })
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
      gapLimit = DEFAULT_GAP_LIMIT,
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
     * In addition it also retrieves spent transaction outputs (STXOS) which correspond
     * to previous UTXOs that have been spent.
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
     * It also returns previous UTXOs that had been
     * eventually spent as stxos: Array<Stxo>
     * Finally, it returns `txoMap`. `txoMap` maps all the txos (unspent or spent
     * outputs) with their corresponding `indexedDescriptor: IndexedDescriptor`
     * (see {@link IndexedDescriptor IndexedDescriptor})
     *
     */
    getUtxosAndBalance({
      descriptor,
      index,
      descriptors,
      txStatus = TxStatus.ALL
    }: OutputCriteria): {
      utxos: Array<Utxo>;
      stxos: Array<Stxo>;
      txoMap: TxoMap;
      balance: number;
    } {
      this.#ensureFetched({
        ...(descriptor ? { descriptor } : {}),
        ...(descriptors ? { descriptors } : {}),
        ...(index !== undefined ? { index } : {})
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
          descriptorOrDescriptors as Descriptor,
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
          false,
          networkId,
          txMap,
          descriptorMap,
          canonicalize(descriptor, network) as Descriptor,
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
     * This method accesses transaction records associated with descriptor expressions
     * and transaction status.
     *
     * When `withAttributions` is `false`, it returns an array of historical transactions
     * (`Array<TxData>`). See {@link TxData TxData}.
     *
     * To determine if each transaction corresponds to a sent/received transaction, set
     * `withAttributions` to `true`.
     *
     * When `withAttributions` is `true`, this function returns an array of
     * {@link TxAttribution TxAttribution} elements.
     *
     * `TxAttribution` identifies the owner of the previous output for each input and
     * the owner of the output for each transaction.
     *
     * This is useful in wallet applications to specify whether inputs are from owned
     * outputs (e.g., change from a previous transaction) or from third parties. It
     * also specifies if outputs are destined to third parties or are internal change.
     * This helps wallet apps show transaction history with "Sent" or "Received" labels,
     * considering only transactions with third parties.
     *
     * See {@link TxAttribution TxAttribution} for a complete list of items returned per
     * transaction.
     *
     * The return value is computed based on the current state of `discoveryData`. The
     * method uses memoization to maintain the same object reference for the returned
     * result, given the same input parameters, as long as the corresponding transaction
     * records in `discoveryData` haven't changed.
     *
     * This can be useful in environments such as React, where preserving object identity
     * can prevent unnecessary re-renders.
     *
     * @param outputCriteria - Criteria for selecting transaction outputs, including descriptor
     * expressions, transaction status, and whether to include attributions.
     * @param withAttributions - Whether to include attributions in the returned data.
     * @returns An array containing transaction information associated with the descriptor
     * expressions.
     */

    getHistory(
      {
        descriptor,
        index,
        descriptors,
        txStatus = TxStatus.ALL
      }: OutputCriteria,
      withAttributions = false
    ): Array<TxData> | Array<TxAttribution> {
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
        ...(index !== undefined ? { index } : {})
      });
      const networkId = getNetworkId(network);
      const descriptorMap = this.#discoveryData[networkId].descriptorMap;
      const txMap = this.#discoveryData[networkId].txMap;

      let txWithOrderArray: Array<TxData> = [];
      if (
        descriptor &&
        (typeof index !== 'undefined' || !descriptor.includes('*'))
      ) {
        const internalIndex = typeof index === 'number' ? index : 'non-ranged';
        txWithOrderArray = this.#derivers.deriveHistoryByOutput(
          withAttributions,
          networkId,
          txMap,
          descriptorMap,
          descriptorOrDescriptors as Descriptor,
          internalIndex,
          txStatus
        );
      } else
        txWithOrderArray = this.#derivers.deriveHistory(
          withAttributions,
          networkId,
          txMap,
          descriptorMap,
          descriptorOrDescriptors,
          txStatus
        );

      return txWithOrderArray;
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
      if (!txHex)
        throw new Error(
          `Error: txHex not found for ${txId} while getting TxHex`
        );
      return txHex;
    }

    /**
     * Retrieves the transaction data as a bitcoinjs-lib
     * {@link https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/ts_src/transaction.ts Transaction}
     * object given the transaction
     * ID (TxId) or a Unspent Transaction Output (Utxo) or the hexadecimal
     * representation of the transaction (it will then use memoization).
     * The transaction data is obtained by first getting
     * the transaction hexadecimal representation using getTxHex() method
     * (unless the txHex was passed).
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
      txHex,
      utxo
    }: {
      /**
       * The transaction ID.
       */
      txId?: TxId;
      /**
       * The transaction txHex.
       */
      txHex?: TxId;
      /**
       * The UTXO.
       */
      utxo?: Utxo;
    }): Transaction {
      if (!txHex)
        txHex = this.getTxHex({
          ...(utxo ? { utxo } : {}),
          ...(txId ? { txId } : {})
        });
      return this.#derivers.transactionFromHex(txHex).tx;
    }

    /**
     * Compares two transactions based on their blockHeight and input dependencies.
     * Can be used as callback in Array.sort function to sort from old to new.
     *
     * @param txWithOrderA - The first transaction data to compare.
     * @param txWithOrderB - The second transaction data to compare.
     *
     * txWithOrderA and txWithOrderB should contain the `blockHeight` (use 0 if
     * in the mempool) and either `tx` (`Transaction` type) or `txHex` (the
     * hexadecimal representation of the transaction)
     *
     * @returns < 0 if txWithOrderA is older than txWithOrderB, > 0 if
     * txWithOrderA is newer than txWithOrderB, and 0 if undecided.
     */
    compareTxOrder<TA extends TxWithOrder, TB extends TxWithOrder>(
      txWithOrderA: TA,
      txWithOrderB: TB
    ): number {
      return this.#derivers.compareTxOrder(txWithOrderA, txWithOrderB);
    }

    /**
     * Given an unspent tx output, this function retrieves its descriptor (if still unspent).
     * Alternatively, pass a txo (any transaction output, which may have been
     * spent already or not) and this function will also retrieve its descriptor.
     * txo can be in any of these formats: `${txId}:${vout}` or
     * using its extended form: `${txId}:${vout}:${recipientTxId}:${recipientVin}`
     *
     * Returns the descriptor (and index if ranged) or undefined if not found.
     */
    getDescriptor({
      utxo,
      txo
    }: {
      /**
       * The UTXO.
       */
      utxo?: Utxo;
      txo?: Utxo;
    }):
      | {
          descriptor: Descriptor;
          index?: number;
        }
      | undefined {
      if (utxo && txo) throw new Error('Pass either txo or utxo, not both');
      if (utxo) txo = utxo;
      const networkId = getNetworkId(network);
      if (!txo) throw new Error('Pass either txo or utxo');
      const split = txo.split(':');
      if (utxo && split.length !== 2)
        throw new Error(`Error: invalid utxo: ${utxo}`);
      if (!utxo && split.length !== 2 && split.length !== 4)
        throw new Error(`Error: invalid txo: ${txo}`);
      const txId = split[0];
      if (!txId) throw new Error(`Error: invalid txo: ${txo}`);
      const strVout = split[1];
      if (!strVout) throw new Error(`Error: invalid txo: ${txo}`);
      const vout = parseInt(strVout);
      if (vout.toString() !== strVout)
        throw new Error(`Error: invalid txo: ${txo}`);

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
      const { utxos, txoMap } = this.getUtxosAndBalance({ descriptors });
      const txoMapKey: Txo = `${txId}:${vout}`; //normalizes txos with 4 parts
      const indexedDescriptor = txoMap[txoMapKey];
      if (indexedDescriptor) {
        if (utxo && !utxos.find(currentUtxo => currentUtxo === utxo))
          return undefined;
        const splitTxo = (str: string): [string, string] => {
          const lastIndex = str.lastIndexOf('~');
          if (lastIndex === -1)
            throw new Error(`Separator '~' not found in string`);
          return [str.slice(0, lastIndex), str.slice(lastIndex + 1)];
        };
        const [descriptor, internalIndex] = splitTxo(indexedDescriptor);

        output = {
          descriptor,
          ...(internalIndex === 'non-ranged'
            ? {}
            : { index: Number(internalIndex) })
        };
      }

      return output;
    }

    /**
     * Pushes a transaction to the network and updates the internal state
     * accordingly. This function ensures that the transaction is pushed,
     * verifies its presence in the mempool, and updates the internal
     * `discoveryData` to include the new transaction.
     *
     * The `gapLimit` parameter is essential for managing descriptor discovery.
     * When pushing a transaction, there is a possibility of receiving new funds
     * as change. If the range for that index does not exist yet, the `gapLimit`
     * helps to update the descriptor corresponding to a new UTXO for new
     * indices within the gap limit.
     *
     * This function may throw an error if the transaction being pushed (`txHex`)
     * attempts to spend an output that this library instance already considers
     * spent (or in the mempool to be spent).
     *
     * For example, if a wallet UTXO is spent by a transaction (Tx1) which is
     * then broadcasted and resides in the mempool, a subsequent attempt to push
     * another transaction (Tx2) that also spends the same original UTXO (e.g.,
     * for RBF) might exhibit this behavior. While `explorer.push(tx2Hex)`
     * could successfully broadcast Tx2, the internal update via
     * `this.addTransaction(tx2Data)` is likely to fail. This occurs because
     * `addTransaction` will detect that an input of Tx2 is already marked as
     * spent by Tx1 in the library's state, throwing an error similar to:
     * `Tx ${txId} was already spent.`.
     *
     * To handle such scenarios, it is recommended to wrap calls to `push` in a
     * try-catch block. If an error is caught, performing a full `fetch`
     * operation can help resynchronize the internal state with the blockchain.
     *
     */
    async push({
      txHex,
      gapLimit = DEFAULT_GAP_LIMIT
    }: {
      /**
       * The hexadecimal representation of the transaction to push.
       */
      txHex: TxHex;
      /**
       * The gap limit for descriptor discovery. Defaults to 20.
       */
      gapLimit?: number;
    }): Promise<void> {
      const DETECTION_INTERVAL = 3000;
      const DETECT_RETRY_MAX = 20;
      const { txId } = this.#derivers.transactionFromHex(txHex);

      await explorer.push(txHex);

      //Now, make sure it made it to the mempool:
      let found = false;
      for (let i = 0; i < DETECT_RETRY_MAX; i++) {
        if (await explorer.fetchTx(txId)) {
          found = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, DETECTION_INTERVAL));
      }

      const txData = { irreversible: false, blockHeight: 0, txHex };
      this.addTransaction({ txData, gapLimit });
      if (found === false)
        console.warn(
          `txId ${txId} was pushed. However, it was then not found in the mempool. It has been set as part of the discoveryData anyway.`
        );
    }

    /*
     * Given a transaction it updates the internal `discoveryData` state to
     * include it.
     *
     * This function is useful when a transaction affecting one of the
     * descriptors has been pushed to the blockchain by a third party. It allows
     * updating the internal representation without performing a more expensive
     * `fetch` operation.
     *
     * If the transaction was recently pushed to the blockchain, set
     * `txData.irreversible = false` and `txData.blockHeight = 0`.
     *
     * The transaction is represented by `txData`, where
     * `txData = { blockHeight: number; irreversible: boolean; txHex: TxHex; }`.
     *
     * It includes its hexadecimal representation `txHex`, its `blockHeight`
     * (zero if it's in the mempool), and whether it is `irreversible` or
     * not. `irreversible` is set by the Explorer, using the configuration parameter
     * `irrevConfThresh` (defaults to `IRREV_CONF_THRESH = 3`). It can be obtained
     * by calling explorer.fetchTxHistory(), for example. Set it to
     * `false` when it's been just pushed (which will be the typical use of this
     * function).
     *
     * The `gapLimit` parameter is essential for managing descriptor discovery.
     * When addint a transaction, there is a possibility the transaction is
     * adding new funds as change (for example). If the range for that index
     * does not exist yet, the `gapLimit` helps to update the descriptor
     * corresponding to a new UTXO for new indices within the gap limit.
     *
     * This function will throw if the transaction attempts to spend an output
     * that the library recognizes as a previously spent output (or in the
     * mempool to be spent).
     * For more details on this scenario, refer to the `push` method's
     * documentation.
     */
    addTransaction({
      txData,
      gapLimit = DEFAULT_GAP_LIMIT
    }: {
      /**
       * The hexadecimal representation of the tx and its associated data.
       * `txData = { blockHeight: number; irreversible: boolean; txHex: TxHex; }`.
       */
      txData: TxData;
      /**
       * The gap limit for descriptor discovery. Defaults to 20.
       */
      gapLimit?: number;
    }): void {
      const txHex = txData.txHex;
      if (!txHex)
        throw new Error('txData must contain complete txHex information');
      const { tx, txId } = this.#derivers.transactionFromHex(txHex);
      const networkId = getNetworkId(network);

      this.#discoveryData = produce(this.#discoveryData, discoveryData => {
        const txMap = discoveryData[networkId].txMap;
        const update = (descriptor: Descriptor, index: DescriptorIndex) => {
          const range =
            discoveryData[networkId].descriptorMap[descriptor]?.range;
          if (!range) throw new Error(`unset range ${networkId}:${descriptor}`);
          const outputData = range[index];
          if (!outputData)
            throw new Error(
              `unset index ${index} for descriptor ${descriptor}`
            );
          //Note that update is called twice (for inputs and outputs), so
          //don't push twice when auto-sending from same utxo to same output
          if (!outputData.txIds.includes(txId)) outputData.txIds.push(txId);
          if (!txMap[txId]) txMap[txId] = txData; //Only add it once
        };

        // search for inputs
        for (let vin = 0; vin < tx.ins.length; vin++) {
          const input = tx.ins[vin];
          if (!input)
            throw new Error(`Error: invalid input for ${txId}:${vin}`);
          //Note we create a new Buffer since reverse() mutates the Buffer
          const prevTxId = Buffer.from(input.hash).reverse().toString('hex');
          const prevVout = input.index;
          const prevUtxo: Utxo = `${prevTxId}:${prevVout}`;
          const extendedDescriptor = this.getDescriptor({ utxo: prevUtxo });
          if (extendedDescriptor)
            //This means this tx is spending an utxo tracked by this discovery instance
            update(
              extendedDescriptor.descriptor,
              extendedDescriptor.index === undefined
                ? 'non-ranged'
                : extendedDescriptor.index
            );
          else if (this.getDescriptor({ txo: prevUtxo }))
            throw new Error(`Tx ${txId} was already spent.`);
        }

        // search for outputs
        for (let vout = 0; vout < tx.outs.length; vout++) {
          const nextScriptPubKey = tx.outs[vout]?.script;
          if (!nextScriptPubKey)
            throw new Error(`Error: invalid output script for ${txId}:${vout}`);
          const descriptorWithIndex = this.#getDescriptorByScriptPubKey({
            networkId,
            scriptPubKey: nextScriptPubKey,
            gapLimit
          });
          if (descriptorWithIndex)
            //This means this tx is sending funds to a scriptPubKey tracked by
            //this discovery instance
            update(descriptorWithIndex.descriptor, descriptorWithIndex.index);
        }
      });
    }

    /**
     * Retrieves the Explorer instance.
     *
     * @returns The Explorer instance.
     */
    getExplorer(): Explorer {
      return explorer;
    }

    /**
     * Exports the current state of the Discovery instance.
     * This method is used to serialize the state of the Discovery instance so
     * that it can be saved and potentially re-imported later using the
     * `imported` parameter in the constructor.
     *
     * The exported data includes a version string and a deep clone of the
     * internal discovery data. The deep cloning process ensures that the
     * exported data is a snapshot of the internal state, isolated from future
     * changes to the Discovery instance. This isolation maintains the integrity
     * and immutability of the exported data.
     *
     * The inclusion of a version string in the exported data allows for
     * compatibility checks when re-importing the data. This check ensures that
     * the data model of the imported data is compatible with the current
     * version of the Discovery class.
     *
     * The exported data is guaranteed to be serializable, allowing it to be
     * safely stored or transmitted. It can be serialized using JSON.stringify
     * or other serialization methods, such as structured serialization
     * (https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal).
     * This feature ensures that the data can be serialized and deserialized
     * without loss of integrity, facilitating data persistence
     * and transfer across different sessions or environments.
     *
     * @returns An object containing the version string and the serialized discovery data.
     */
    export() {
      return {
        version: DATA_MODEL_VERSION,
        discoveryData: cloneDeep(this.#discoveryData)
      };
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
