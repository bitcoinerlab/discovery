// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

import memoizee from 'memoizee';
import { memoizeOneWithShallowArraysCheck } from './memoizers';
import { shallowEqualArrays } from 'shallow-equal';
import {
  NetworkId,
  OutputData,
  Descriptor,
  Account,
  DescriptorIndex,
  DiscoveryData,
  Utxo,
  TxStatus,
  DescriptorData,
  TxId,
  TxData
} from './types';
import { Transaction, Network } from 'bitcoinjs-lib';
import { DescriptorsFactory } from '@bitcoinerlab/descriptors';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
const { Output, expand } = DescriptorsFactory(secp256k1);
import { getNetwork } from './networks';

export function canonicalize(
  descriptorOrDescriptors: Array<Descriptor> | Descriptor,
  network: Network
) {
  let isDifferent = false;
  const descriptorArray = Array.isArray(descriptorOrDescriptors)
    ? descriptorOrDescriptors
    : [descriptorOrDescriptors];
  const canonicalDescriptors: Array<Descriptor> = [];
  descriptorArray.forEach(descriptor => {
    const canonicalDescriptor = expand({
      descriptor,
      network
    }).canonicalExpression;
    if (descriptor !== canonicalDescriptor) isDifferent = true;
    canonicalDescriptors.push(canonicalDescriptor);
  });
  if (Array.isArray(descriptorOrDescriptors)) {
    if (isDifferent) return canonicalDescriptors;
    else return descriptorOrDescriptors;
  } else {
    const canonicalDescriptor = canonicalDescriptors[0];
    if (!canonicalDescriptor)
      throw new Error(`Could not canonicalize ${descriptorOrDescriptors}`);
    return canonicalDescriptor;
  }
}

export function deriveDataFactory({
  descriptorsCacheSize = 0,
  outputsPerDescriptorCacheSize = 0
}: {
  descriptorsCacheSize: number;
  outputsPerDescriptorCacheSize: number;
}) {
  const deriveScriptPubKeyFactory = memoizee(
    (networkId: NetworkId) =>
      memoizee(
        (descriptor: Descriptor) =>
          memoizee(
            (index: DescriptorIndex) => {
              const network = getNetwork(networkId);
              //Note there is no need to pass a network (bitcoin will be default) but
              //it's not important anyway since the scriptPubKey does not depend on
              //the network
              const output =
                index === 'non-ranged'
                  ? new Output({ descriptor, network })
                  : new Output({ descriptor, index, network });
              const scriptPubKey = output.getScriptPubKey();
              return scriptPubKey;
            },
            { primitive: true, max: outputsPerDescriptorCacheSize }
          ),
        { primitive: true, max: descriptorsCacheSize }
      ),
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );
  const deriveScriptPubKey = (
    networkId: NetworkId,
    descriptor: Descriptor,
    index: DescriptorIndex
  ) => deriveScriptPubKeyFactory(networkId)(descriptor)(index);

  const coreDeriveUtxosByOutput = (
    networkId: NetworkId,
    descriptor: Descriptor,
    index: DescriptorIndex,
    txDataArray: Array<TxData>,
    txStatus: TxStatus
  ): Array<Utxo> => {
    const scriptPubKey = deriveScriptPubKey(networkId, descriptor, index);

    const allOutputs: Utxo[] = [];
    const spentOutputs: Utxo[] = [];

    //Note that txDataArray cannot be assumed to be in correct order. See:
    //https://github.com/Blockstream/esplora/issues/165#issuecomment-1584471718
    //TODO: but we should guarantee same order always so use txId as second order criteria?
    for (const txData of txDataArray) {
      if (
        txStatus === TxStatus.ALL ||
        (txStatus === TxStatus.IRREVERSIBLE && txData.irreversible) ||
        (txStatus === TxStatus.CONFIRMED && txData.blockHeight !== 0)
      ) {
        const txHex = txData.txHex;
        if (!txHex)
          throw new Error(
            `txHex not yet retrieved for an element of ${descriptor}, ${index}`
          );
        const tx = transactionFromHex(txHex);
        const txId = tx.getId();

        for (let vin = 0; vin < tx.ins.length; vin++) {
          const input = tx.ins[vin];
          if (!input)
            throw new Error(`Error: invalid input for ${txId}:${vin}`);
          //Note we create a new Buffer since reverse() mutates the Buffer
          const inputId = Buffer.from(input.hash).reverse().toString('hex');
          const spentOutputKey: Utxo = `${inputId}:${input.index}`;
          spentOutputs.push(spentOutputKey);
        }

        for (let vout = 0; vout < tx.outs.length; vout++) {
          const outputScript = tx.outs[vout]?.script;
          if (!outputScript)
            throw new Error(`Error: invalid output script for ${txId}:${vout}`);
          if (outputScript.equals(scriptPubKey)) {
            const outputKey: Utxo = `${txId}:${vout}`;
            allOutputs.push(outputKey);
          }
        }
      }
    }

    // UTXOs are those in allOutputs that are not in spentOutputs
    const utxos = allOutputs.filter(output => !spentOutputs.includes(output));

    return utxos;
  };

  const deriveUtxosAndBalanceByOutputFactory = memoizee(
    (networkId: NetworkId) =>
      memoizee(
        (txStatus: TxStatus) =>
          memoizee(
            (descriptor: Descriptor) =>
              memoizee(
                (index: DescriptorIndex) => {
                  // Create one function per each expression x index x txStatus
                  // coreDeriveUtxosByOutput shares all params wrt the parent
                  // function except for additional param txDataArray.
                  // As soon as txDataArray in coreDeriveUtxosByOutput changes,
                  // it will resets its memory. However, it always returns the same
                  // reference if the resulting array is shallowy-equal:
                  const deriveUtxosByOutput = memoizeOneWithShallowArraysCheck(
                    coreDeriveUtxosByOutput
                  );
                  let lastUtxos: Array<Utxo> | null = null;
                  let lastBalance: number;
                  return memoizee(
                    (
                      txMap: Record<TxId, TxData>,
                      descriptorMap: Record<Descriptor, DescriptorData>
                    ) => {
                      const txDataArray = deriveTxDataArray(
                        txMap,
                        descriptorMap,
                        descriptor,
                        index
                      );
                      const utxos = deriveUtxosByOutput(
                        networkId,
                        descriptor,
                        index,
                        txDataArray,
                        txStatus
                      );
                      if (lastUtxos && shallowEqualArrays(lastUtxos, utxos))
                        return { utxos: lastUtxos, balance: lastBalance };
                      lastUtxos = utxos;
                      lastBalance = coreDeriveUtxosBalance(txMap, utxos);
                      return { utxos, balance: lastBalance };
                    },
                    { max: 1 }
                  );
                },
                { primitive: true, max: outputsPerDescriptorCacheSize }
              ),
            { primitive: true, max: descriptorsCacheSize }
          ),
        { primitive: true } //unbounded cache (no max setting) since Search Space is small
      ),
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );

  const deriveUtxosAndBalanceByOutput = (
    networkId: NetworkId,
    txMap: Record<TxId, TxData>,
    descriptorMap: Record<Descriptor, DescriptorData>,
    descriptor: Descriptor,
    index: DescriptorIndex,
    txStatus: TxStatus
  ) =>
    deriveUtxosAndBalanceByOutputFactory(networkId)(txStatus)(descriptor)(
      index
    )(txMap, descriptorMap);

  const coreDeriveTxDataArray = (
    txIds: Array<TxId>,
    txMap: Record<TxId, TxData>
  ): Array<TxData> =>
    txIds.map(txId => {
      const txData = txMap[txId];
      if (!txData) throw new Error(`txData not saved for ${txId}`);
      return txData;
    });

  const deriveTxDataArrayFactory = memoizee(
    (descriptor: Descriptor) =>
      memoizee(
        (index: DescriptorIndex) => {
          return memoizeOneWithShallowArraysCheck(
            (
              txMap: Record<TxId, TxData>,
              descriptorMap: Record<Descriptor, DescriptorData>
            ) => {
              const range = deriveUsedRange(descriptorMap[descriptor]);
              const txIds = range[index]?.txIds || [];
              const txDataArray = coreDeriveTxDataArray(txIds, txMap);
              return txDataArray;
            }
          );
        },
        { primitive: true, max: outputsPerDescriptorCacheSize }
      ),
    { primitive: true, max: descriptorsCacheSize }
  );

  const deriveTxDataArray = (
    txMap: Record<TxId, TxData>,
    descriptorMap: Record<Descriptor, DescriptorData>,
    descriptor: Descriptor,
    index: DescriptorIndex
  ) => deriveTxDataArrayFactory(descriptor)(index)(txMap, descriptorMap);

  const deriveHistoryByOutputFactory = memoizee(
    (txStatus: TxStatus) =>
      memoizee(
        (descriptor: Descriptor) =>
          memoizee(
            (index: DescriptorIndex) => {
              return memoizeOneWithShallowArraysCheck(
                (
                  txMap: Record<TxId, TxData>,
                  descriptorMap: Record<Descriptor, DescriptorData>
                ) => {
                  const txDataArray = deriveTxDataArray(
                    txMap,
                    descriptorMap,
                    descriptor,
                    index
                  );
                  return txDataArray.filter(
                    txData =>
                      txStatus === TxStatus.ALL ||
                      (txStatus === TxStatus.IRREVERSIBLE &&
                        txData.irreversible) ||
                      (txStatus === TxStatus.CONFIRMED &&
                        txData.blockHeight !== 0)
                  );
                }
              );
            },
            {
              primitive: true,
              max: outputsPerDescriptorCacheSize
            }
          ),
        { primitive: true, max: descriptorsCacheSize }
      ),
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );
  const deriveHistoryByOutput = (
    txMap: Record<TxId, TxData>,
    descriptorMap: Record<Descriptor, DescriptorData>,
    descriptor: Descriptor,
    index: DescriptorIndex,
    txStatus: TxStatus
  ) =>
    deriveHistoryByOutputFactory(txStatus)(descriptor)(index)(
      txMap,
      descriptorMap
    );

  const coreDeriveHistory = (
    descriptorMap: Record<Descriptor, DescriptorData>,
    txMap: Record<TxId, TxData>,
    descriptorOrDescriptors: Array<Descriptor> | Descriptor,
    txStatus: TxStatus
  ): Array<TxData> => {
    const history: Array<TxData> = [];
    const descriptorArray = Array.isArray(descriptorOrDescriptors)
      ? descriptorOrDescriptors
      : [descriptorOrDescriptors];
    for (const descriptor of descriptorArray) {
      const range = deriveUsedRange(descriptorMap[descriptor]);
      Object.keys(range)
        .sort() //Sort it to be deterministic
        .forEach(indexStr => {
          const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
          history.push(
            ...deriveHistoryByOutput(
              txMap,
              descriptorMap,
              descriptor,
              index,
              txStatus
            )
          );
        });
    }
    //Deduplicate in case of an expression receiving from another expression
    //and sort again by blockHeight
    const dedupedHistory = [...new Set(history)];
    //since we have txs belonging to different expressions let's try to oder
    //them. Note that we cannot guarantee to keep correct order to txs
    //that belong to the same blockHeight
    //TODO: but we should guarantee same order always so use txId as second order criteria?
    return dedupedHistory.sort(
      (txDataA, txDataB) => txDataA.blockHeight - txDataB.blockHeight
    );
  };

  const deriveHistoryFactory = memoizee(
    (txStatus: TxStatus) =>
      memoizee(
        (descriptorOrDescriptors: Array<Descriptor> | Descriptor) => {
          return memoizeOneWithShallowArraysCheck(
            (
              txMap: Record<TxId, TxData>,
              descriptorMap: Record<Descriptor, DescriptorData>
            ) =>
              coreDeriveHistory(
                descriptorMap,
                txMap,
                descriptorOrDescriptors,
                txStatus
              )
          );
        },
        { primitive: true, max: descriptorsCacheSize }
      ),
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );
  const deriveHistory = (
    txMap: Record<TxId, TxData>,
    descriptorMap: Record<Descriptor, DescriptorData>,
    descriptorOrDescriptors: Array<Descriptor> | Descriptor,
    txStatus: TxStatus
  ) =>
    deriveHistoryFactory(txStatus)(descriptorOrDescriptors)(
      txMap,
      descriptorMap
    );

  const coreDeriveUtxos = (
    networkId: NetworkId,
    descriptorMap: Record<Descriptor, DescriptorData>,
    txMap: Record<TxId, TxData>,
    descriptorOrDescriptors: Array<Descriptor> | Descriptor,
    txStatus: TxStatus
  ): Array<Utxo> => {
    const utxos: Utxo[] = [];
    const descriptorArray = Array.isArray(descriptorOrDescriptors)
      ? descriptorOrDescriptors
      : [descriptorOrDescriptors];
    for (const descriptor of descriptorArray) {
      const range = deriveUsedRange(descriptorMap[descriptor]);
      Object.keys(range)
        .sort() //Sort it to be deterministic
        .forEach(indexStr => {
          const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
          utxos.push(
            ...deriveUtxosAndBalanceByOutput(
              networkId,
              txMap,
              descriptorMap,
              descriptor,
              index,
              txStatus
            ).utxos
          );
        });
    }
    //Deduplicate in case of expression: Array<Descriptor> with duplicated
    //descriptorOrDescriptors
    const dedupedUtxos = [...new Set(utxos)];
    return dedupedUtxos;
  };

  //unbound memoizee wrt TxStatus is fine since it has a small Search Space
  //however the search space for expressions must be bounded
  //returns {balance, utxos}. The reference of utxos will be kept the same for
  //each tuple of txStatus x expressions
  const deriveUtxosAndBalanceFactory = memoizee(
    (networkId: NetworkId) =>
      memoizee(
        (txStatus: TxStatus) =>
          memoizee(
            (descriptorOrDescriptors: Array<Descriptor> | Descriptor) => {
              let lastUtxos: Array<Utxo> | null = null;
              let lastBalance: number;
              return memoizee(
                (
                  txMap: Record<TxId, TxData>,
                  descriptorMap: Record<Descriptor, DescriptorData>
                ) => {
                  const utxos = coreDeriveUtxos(
                    networkId,
                    descriptorMap,
                    txMap,
                    descriptorOrDescriptors,
                    txStatus
                  );
                  if (lastUtxos && shallowEqualArrays(lastUtxos, utxos))
                    return { utxos: lastUtxos, balance: lastBalance };
                  lastUtxos = utxos;
                  lastBalance = coreDeriveUtxosBalance(txMap, utxos);
                  return { utxos, balance: lastBalance };
                },
                { max: 1 }
              );
            },
            { primitive: true, max: descriptorsCacheSize } //potentially ininite search space. limit to 100 descriptorOrDescriptors per txStatus combination
          ),
        { primitive: true } //unbounded cache (no max setting) since Search Space is small
      ),
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );

  const deriveUtxosAndBalance = (
    networkId: NetworkId,
    txMap: Record<TxId, TxData>,
    descriptorMap: Record<Descriptor, DescriptorData>,
    descriptorOrDescriptors: Array<Descriptor> | Descriptor,
    txStatus: TxStatus
  ) =>
    deriveUtxosAndBalanceFactory(networkId)(txStatus)(descriptorOrDescriptors)(
      txMap,
      descriptorMap
    );

  const transactionFromHex = memoizee(Transaction.fromHex, {
    primitive: true,
    max: 1000
  });

  const coreDeriveUtxosBalance = (
    txMap: Record<TxId, TxData>,
    utxos: Array<Utxo>
  ): number => {
    let balance = 0;

    const firstDuplicate = utxos.find((element, index, arr) => {
      return arr.indexOf(element) !== index;
    });
    if (firstDuplicate !== undefined)
      throw new Error(`Duplicated utxo: ${firstDuplicate}`);

    for (const utxo of utxos) {
      const [txId, voutStr] = utxo.split(':');
      if (!txId || !voutStr)
        throw new Error(`Undefined txId or vout for UTXO: ${utxo}`);
      const vout = parseInt(voutStr);

      const txData = txMap[txId];
      if (!txData)
        throw new Error(`txData not saved for ${txId}, vout:${vout} - ${utxo}`);
      const txHex = txData.txHex;
      if (!txHex) throw new Error(`txHex not yet retrieved for ${txId}`);
      const tx = transactionFromHex(txHex);
      const output = tx.outs[vout];
      if (!output) throw new Error(`Error: invalid output for ${txId}:${vout}`);
      const outputValue = output.value; // value in satoshis
      balance += outputValue;
    }
    return balance;
  };

  /**
   * Filters the provided descriptor object's range with
   * records that have non-empty transaction ID arrays.
   *
   * @returns An object containing only the records from the input range with
   * non-empty txIds arrays.
   */
  function deriveUsedRange(descriptorData?: DescriptorData) {
    const usedRange = {} as Record<DescriptorIndex, OutputData>;
    if (!descriptorData) return usedRange;

    for (const [indexStr, outputData] of Object.entries(descriptorData.range)) {
      const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
      if (outputData.txIds.length > 0) usedRange[index] = outputData;
    }
    return usedRange;
  }

  function isDescriptorUsed(descriptorData?: DescriptorData) {
    return Object.keys(deriveUsedRange(descriptorData)).length !== 0;
  }

  const coreDeriveUsedDescriptors = (
    discoveryData: DiscoveryData,
    networkId: NetworkId
  ) => {
    const descriptorMap = discoveryData[networkId].descriptorMap;
    return Object.keys(descriptorMap)
      .filter(descriptor => isDescriptorUsed(descriptorMap[descriptor]))
      .sort();
  };

  const deriveUsedDescriptorsFactory = memoizee(
    (networkId: NetworkId) => {
      return memoizeOneWithShallowArraysCheck((discoveryData: DiscoveryData) =>
        coreDeriveUsedDescriptors(discoveryData, networkId)
      );
    },
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );

  /**
   * Extracts and returns descriptor expressions that are associated with at
   * least one utilized scriptPubKey from the discovery information. The
   * function is optimized to maintain and return the same array object for
   * each unique networkId if the resulting expressions did not change.
   * This helps to avoid unnecessary data processing and memory usage.
   *
   * @returns Descriptor expressions.
   */
  const deriveUsedDescriptors = (
    /** The network identifier. */
    discoveryData: DiscoveryData,
    /** Descriptor expressions. */
    networkId: NetworkId
  ) => deriveUsedDescriptorsFactory(networkId)(discoveryData);

  /**
   * Derives the accounts from the discoveryData.
   * Descriptor expressions of an account share the same pattern, except for
   * their keyInfo, which can end with either /0/* or /1/*.
   * An Account is represented by its external descriptor.
   *
   * @param {NetworkId} networkId
   * @returns {Array<Account>}- Returns an array of accounts.
   */
  const coreDeriveUsedAccounts = (
    discoveryData: DiscoveryData,
    networkId: NetworkId
  ): Array<Account> => {
    const descriptors = coreDeriveUsedDescriptors(discoveryData, networkId);
    const network = getNetwork(networkId);
    const accountSet = new Set<Account>(); //Use Set to avoid duplicates

    for (const descriptor of descriptors) {
      const { expansionMap } = expand({ descriptor, network });
      if (expansionMap)
        for (const keyInfo of Object.values(expansionMap)) {
          if (!keyInfo) {
            throw new Error(
              `Missing keyInfo in expansionMap for descriptor ${descriptor}`
            );
          }

          if (keyInfo.keyPath === '/0/*' || keyInfo.keyPath === '/1/*') {
            const account = descriptor.replace(/\/1\/\*/g, '/0/*');
            accountSet.add(account);
          }
        }
    }
    return Array.from(accountSet).sort(); //sort the Array so it's deterministic
  };

  const deriveUsedAccountsFactory = memoizee(
    (networkId: NetworkId) => {
      return memoizeOneWithShallowArraysCheck((discoveryData: DiscoveryData) =>
        coreDeriveUsedAccounts(discoveryData, networkId)
      );
    },
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );

  const deriveUsedAccounts = (
    discoveryData: DiscoveryData,
    networkId: NetworkId
  ) => deriveUsedAccountsFactory(networkId)(discoveryData);

  const deriveAccountDescriptors = memoizee(
    (account: Account): [Descriptor, Descriptor] => [
      account,
      account.replace(/\/0\/\*/g, '/1/*')
    ],
    { primitive: true, max: descriptorsCacheSize }
  );

  return {
    deriveScriptPubKey,
    deriveUtxosAndBalanceByOutput,
    deriveUtxosAndBalance,
    deriveUsedDescriptors,
    deriveUsedAccounts,
    deriveAccountDescriptors,
    deriveHistoryByOutput,
    deriveHistory,
    transactionFromHex
  };
}
