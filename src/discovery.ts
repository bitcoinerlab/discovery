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
    #discoveryData: DiscoveryData;

    /**
     * Constructs a Discovery instance. Discovery is used to discover funds
     * in a Bitcoin wallet using descriptors.
     *
     * @param options
     */
    constructor(
      {
        descriptorsCacheSize = 1000,
        indicesPerDescriptorCacheSize = 10000
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
        descriptorsCacheSize: number;
        /**
         * Cache size limit for indices per expression, related to the number of addresses
         * in ranged descriptor expressions. Similar to the `descriptorsCacheSize`,
         * this cache is used to speed up data queries and avoid recomputations.
         * As each expression can have multiple indices, the number of indices can grow rapidly,
         * leading to increased memory usage. Setting a limit helps keep memory usage in check,
         * while also maintaining the benefits of immutability and computational efficiency.
         * Set to 0 for unbounded caches.
         * @defaultValue 10000
         */
        indicesPerDescriptorCacheSize: number;
      } = {
        descriptorsCacheSize: 1000,
        indicesPerDescriptorCacheSize: 10000
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
        indicesPerDescriptorCacheSize
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
      const descriptors = this.#derivers.deriveDescriptors(
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
     * Asynchronously discovers an output, given a descriptor expression,
     * descriptor index, and network. It first retrieves the output,
     * computes its scriptHash, and fetches the transaction history associated
     * with this scriptHash from the explorer. It then updates the internal
     * discoveryData accordingly.
     *
     * This function has side-effects as it modifies the internal discoveryData
     * state of the Discovery class instance. This state keeps track of
     * transaction info and descriptors relevant to the discovery process.
     *
     * This method is useful for updating the state of the wallet based on new
     * transactions and scriptPubKeys.
     *
     * This method does not retrieve the txHex associated with the Output.
     * An additional #discoverTxs must be performed.
     *
     * @param options
     * @returns A promise that resolves to a boolean indicating whether any transactions were found for the provided scriptPubKey.
     */
    async #discoverOutput({
      descriptor,
      index,
      network
    }: {
      /**
       * The descriptor expression associated with the scriptPubKey to discover.
       */
      descriptor: Descriptor;
      /**
       * The descriptor index associated with the scriptPubKey to discover (if ranged).
       */
      index?: number;
      /**
       * The network associated with the scriptPubKey to discover.
       */
      network: Network;
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
        if (!range)
          throw new Error(
            `range does not exist for ${networkId} and ${descriptor}`
          );
        const outputData = range[internalIndex];
        const txIds = txHistoryArray.map(txHistory => txHistory.txId);
        if (txIds.length) {
          if (!outputData) {
            this.#ensureScriptPubKeyUniqueness({ networkId, scriptPubKey });
            range[internalIndex] = { txIds, timeFetched: now() };
          } else {
            if (!shallowEqualArrays(txIds, outputData.txIds)) {
              outputData.txIds = txIds;
            }
            outputData.timeFetched = now();
          }
        } else {
          if (outputData) {
            delete range[internalIndex];
          }
        }
      });
      return !!txHistoryArray.length;
    }

    /**
     * Asynchronously fetches all transactions associated with a specific
     * network for all used outputs.
     *
     * @param options
     * @returns Resolves when all the transactions for the provided network have been fetched and stored in discoveryData.
     */
    async #discoverTxs({
      network
    }: {
      /**
       * The network whose transactions are to be fetched.
       */
      network: Network;
    }) {
      const txHexRecords: Record<TxId, TxHex> = {};
      const networkId = getNetworkId(network);
      const networkData = this.#discoveryData[networkId];
      for (const expression in networkData.descriptorMap) {
        const range = networkData.descriptorMap[expression]?.range || [];
        for (const index in range) {
          const txIds = range[index]?.txIds;
          if (!txIds)
            throw new Error(
              `Error: cannot retrieve txs for nonexising scriptPubKey: ${networkId}, ${expression}, ${index}`
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
     * expressions (including txHex).
     *
     * @param options
     * @returns Resolves when the fetch operation completes. If used expressions
     * are found, waits for the discovery of associated transactions.
     */
    async discover({
      descriptor,
      index,
      descriptors,
      gapLimit = 20,
      network,
      onUsed,
      onChecking,
      next
    }: {
      /**
       * Descriptor expression for a single output. Use either `descriptor` or
       * `descriptors`, but not both simultaneously.
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
       * The network to which the outputs belong.
       */
      network: Network;
      /**
       * The gap limit for the fetch operation when retrieving ranged descriptors.
       * @defaultValue 20
       */
      gapLimit?: number;
      /**
       * Optional callback function. Invoked when a used output described by a descriptor is found. Provided with the same input descriptor expressions.
       */
      onUsed?: (
        descriptorOrDescriptors: Descriptor | Array<Descriptor>
      ) => void;
      /**
       * Optional callback function. Invoked when a used descriptor is started to being checked. Provided with the same input descriptor expressions.
       */
      onChecking?: (
        descriptorOrDescriptors: Descriptor | Array<Descriptor>
      ) => void;
      /**
       * Optional function that returns a Promise. Invoked once a used descriptor is found and the Promise it returns is awaited.
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
      let usedDescriptors = false;
      let usedDescriptorsNotified = false;

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
        index = index || 0; //If it was a passed argument use it; othewise start at zero
        const isRanged = descriptor.indexOf('*') !== -1;
        while (isRanged ? gap < gapLimit : index < 1 /*once if unranged*/) {
          const used = await this.#discoverOutput({
            descriptor,
            ...(isRanged ? { index } : {}),
            network
          });

          if (used) {
            usedDescriptors = true;
            gap = 0;
          } else gap++;

          if (used && next && !nextPromise) nextPromise = next();

          index++;

          if (used && onUsed && usedDescriptorsNotified === false) {
            onUsed(descriptorOrDescriptors);
            usedDescriptorsNotified = true;
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
      if (usedDescriptors) promises.push(this.#discoverTxs({ network }));
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
       * The network in which to discover the accounts.
       */
      network: Network;
      /*
       * Callback function called with the account
       * descriptor (external descriptor) of either the wpkh, pkh, or sh(wpkh)
       * script type if they are detected of having been used.
       */
      onAccountUsed?: (account: Account) => void;
      /*
       * Callback function called with the account
       * descriptor (external descriptor) of either the wpkh, pkh, or sh(wpkh)
       * script type the moment they start being checked for funds.
       */
      onAccountChecking?: (account: Account) => void;
    }) {
      const discoveryTasks = [];
      const { pkhBIP32, shWpkhBIP32, wpkhBIP32 } = scriptExpressions;
      if (!network) throw new Error(`Error: provide a network`);
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
          await this.discover({
            descriptors,
            gapLimit,
            network,
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
    getDescriptors({
      network
    }: {
      /**
       * The network associated with the descriptors.
       */
      network: Network;
    }): Array<Descriptor> {
      const networkId = getNetworkId(network);
      return this.#derivers.deriveDescriptors(this.#discoveryData, networkId);
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
      return this.#derivers.deriveAccounts(this.#discoveryData, networkId);
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
       * The account associated with the descriptors.
       */
      account: Account;
    }): [Descriptor, Descriptor] {
      return this.#derivers.deriveAccountDescriptors(account);
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
      network,
      txStatus = TxStatus.ALL
    }: OutputCriteria): { utxos: Array<Utxo>; balance: number } {
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
     * Retrieves the next available index for a given expression within a
     * specified network.
     *
     * The method retrieves the currently highest index used, and returns the
     * next available index by incrementing it by 1.
     *
     * @param options
     * @returns The next available index.
     */
    getNextIndex({
      network,
      descriptor,
      txStatus = TxStatus.ALL
    }: {
      /**
       * The network associated with the account.
       */
      network: Network;
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
     * descriptor expressions within a specified network and transaction status.
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
      network,
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
      const txHex = this.#discoveryData[networkId].txMap[txId]?.txHex;
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
     * Given a UTXO, this function retrieves the descriptor associated
     * with the UTXO. In this function, the output is represented by its
     * descriptor expression (and its corresponding index for
     * ranged-descriptors).
     */
    getUTXODescriptor({
      network,
      utxo
    }: {
      /**
       * The network where the transaction took place.
       */
      network: Network;
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
      const descriptors = this.#derivers.deriveDescriptors(
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
              ...(isRanged ? { index: Number(indexStr) } : {}),
              network
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
