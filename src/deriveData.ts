// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

import memoizee from 'memoizee';
import { memoizeOneWithShallowArraysCheck } from './memoizers';
import { shallowEqualArrays, shallowEqualObjects } from 'shallow-equal';
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
  TxAttribution,
  TxId,
  TxData,
  Stxo,
  TxWithOrder,
  TxoMap
} from './types';
import { Transaction, Network } from 'bitcoinjs-lib';
import { DescriptorsFactory } from '@bitcoinerlab/descriptors';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import { compare, fromHex, toHex } from 'uint8array-tools';
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
  /**
   * Compares two transactions based on their blockHeight and input dependencies.
   * Can be used as callback in Array.sort function to sort from old to new.
   *
   * @param txWithOrderA - The first transaction data to compare.
   * @param txWithOrderB - The second transaction data to compare.
   *
   *
   * txWithOrderA and txWithOrderB should contain the `blockHeight` (use 0 if
   * in the mempool) and either `tx` (`Transaction` type) or `txHex` (the
   * hexadecimal representation of the transaction)
   *
   * @returns < 0 if txWithOrderA is older than txWithOrderB, > 01 if txWithOrderA is newer than txWithOrderB, and 0 if undecided.
   */
  function compareTxOrder<TA extends TxWithOrder, TB extends TxWithOrder>(
    txWithOrderA: TA,
    txWithOrderB: TB
  ): number {
    // txWithOrderA is in mempool and txWithOrderB no, so txWithOrderA is newer
    if (txWithOrderA.blockHeight === 0 && txWithOrderB.blockHeight !== 0)
      return 1;
    // txWithOrderB is in mempool and txWithOrderA no, so txWithOrderB is newer
    if (txWithOrderB.blockHeight === 0 && txWithOrderA.blockHeight !== 0)
      return -1;
    // If blockHeight is different and none are in the mempool, sort by blockHeight
    if (txWithOrderA.blockHeight !== txWithOrderB.blockHeight)
      return txWithOrderA.blockHeight - txWithOrderB.blockHeight;

    // If blockHeight is the same, check input dependencies
    let txA = txWithOrderA.tx;
    let txIdA: string | undefined;
    if (!txA) {
      if (!txWithOrderA.txHex) throw new Error('Pass tx or txHex');
      const { tx, txId } = transactionFromHex(txWithOrderA.txHex);
      txA = tx;
      txIdA = txId;
    }
    let txB = txWithOrderB.tx;
    let txIdB: string | undefined;
    if (!txB) {
      if (!txWithOrderB.txHex) throw new Error('Pass tx or txHex');
      const { tx, txId } = transactionFromHex(txWithOrderB.txHex);
      txB = tx;
      txIdB = txId;
    }
    //getHash is slow, try to avoid it if we can use a cached getId:
    const txHashB = txIdB ? hex2RevBuf(txIdB) : txB.getHash();
    // txA is newer because it uses an input from txB
    for (const Ainput of txA.ins)
      if (compare(Ainput.hash, txHashB) === 0) return 1;

    //getHash is slow, try to avoid it if we can use a cached getId:
    const txHashA = txIdA ? hex2RevBuf(txIdA) : txA.getHash();
    // txB is newer because it uses an input from txA
    for (const Binput of txB.ins)
      if (compare(Binput.hash, txHashA) === 0) return -1;

    return 0; // Cannot decide, keep the original order
  }

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

  const coreDeriveTxosByOutput = (
    networkId: NetworkId,
    descriptor: Descriptor,
    index: DescriptorIndex,
    txWithOrderArray: Array<TxData>,
    txStatus: TxStatus
  ): {
    utxos: Array<Utxo>;
    stxos: Array<Stxo>;
    txoMap: TxoMap;
  } => {
    const scriptPubKey = deriveScriptPubKey(networkId, descriptor, index);
    const txoMap: TxoMap = {};
    //All prev outputs (spent or unspent) sent to this output descriptor:
    const allPrevOutputs: Utxo[] = [];
    //all outputs in txWithOrderArray which have been spent.
    //May be outputs NOT snt to thil output descriptor:
    const spendingTxIdByOutput: Record<Utxo, TxId> = {}; //Means: Utxo was spent in txId

    //Note that txWithOrderArray cannot be assumed to be in correct order if
    //in the same block and if one does not depend on the other. See:
    //https://github.com/Blockstream/esplora/issues/165#issuecomment-1584471718
    for (const txData of txWithOrderArray) {
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
        const { tx, txId } = transactionFromHex(txHex);

        for (const [vin, input] of tx.ins.entries()) {
          const prevTxId = buf2RevHex(input.hash);
          const prevVout = input.index;
          const prevUtxo: Utxo = `${prevTxId}:${prevVout}`;
          spendingTxIdByOutput[prevUtxo] = `${txId}:${vin}`; //prevUtxo was spent by txId in input vin
        }

        for (const [vout, output] of tx.outs.entries()) {
          if (compare(output.script, scriptPubKey) === 0) {
            const txo = `${txId}:${vout}`;
            allPrevOutputs.push(txo);
            txoMap[txo] = `${descriptor}~${index}`;
          }
        }
      }
    }
    // UTXOs are those in allPrevOutputs that have not been spent
    const utxos = allPrevOutputs.filter(
      output => !Object.keys(spendingTxIdByOutput).includes(output)
    );
    const stxos = allPrevOutputs
      .filter(output => Object.keys(spendingTxIdByOutput).includes(output))
      .map(txo => `${txo}:${spendingTxIdByOutput[txo]}`);

    return { utxos, stxos, txoMap };
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
                  // coreDeriveTxosByOutput shares all params wrt the parent
                  // function except for additional param txWithOrderArray.
                  // As soon as txWithOrderArray in coreDeriveTxosByOutput changes,
                  // it will resets its memory.
                  const deriveTxosByOutput = memoizee(coreDeriveTxosByOutput, {
                    max: 1
                  });
                  let lastUtxos: Array<Utxo> | null = null;
                  let lastStxos: Array<Stxo> | null = null;
                  let lastTxoMap: TxoMap | null = null;
                  let lastBalance: bigint;
                  return memoizee(
                    (
                      txMap: Record<TxId, TxData>,
                      descriptorMap: Record<Descriptor, DescriptorData>
                    ) => {
                      const txWithOrderArray = deriveTxDataArray(
                        txMap,
                        descriptorMap,
                        descriptor,
                        index
                      );
                      let { utxos, stxos, txoMap } = deriveTxosByOutput(
                        networkId,
                        descriptor,
                        index,
                        txWithOrderArray,
                        txStatus
                      );
                      let balance: bigint;
                      if (lastTxoMap && shallowEqualObjects(lastTxoMap, txoMap))
                        txoMap = lastTxoMap;
                      if (lastStxos && shallowEqualArrays(lastStxos, stxos))
                        stxos = lastStxos;
                      if (lastUtxos && shallowEqualArrays(lastUtxos, utxos)) {
                        utxos = lastUtxos;
                        balance = lastBalance;
                      } else balance = coreDeriveUtxosBalance(txMap, utxos);

                      lastTxoMap = txoMap;
                      lastUtxos = utxos;
                      lastStxos = stxos;
                      lastBalance = balance;
                      return { txoMap, stxos, utxos, balance };
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
              const txWithOrderArray = coreDeriveTxDataArray(txIds, txMap);
              return txWithOrderArray;
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

  const deriveAttributions = (
    txHistory: Array<TxData>,
    networkId: NetworkId,
    txMap: Record<TxId, TxData>,
    descriptorMap: Record<Descriptor, DescriptorData>,
    descriptorOrDescriptors: Array<Descriptor> | Descriptor,
    txStatus: TxStatus
  ) => {
    const { utxos, stxos } = deriveUtxosAndBalance(
      networkId,
      txMap,
      descriptorMap,
      descriptorOrDescriptors,
      txStatus
    );
    //Suposedly Set.has is faster than Array.includes:
    //https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set#performance
    const txoSet = new Set([
      ...utxos,
      ...stxos.map(stxo => {
        const [txId, voutStr] = stxo.split(':');
        if (txId === undefined || voutStr === undefined) {
          throw new Error(`Undefined txId or vout for STXO: ${stxo}`);
        }
        return `${txId}:${voutStr}`;
      })
    ]);
    return txHistory.map(txData => {
      const { txHex, irreversible, blockHeight } = txData;
      if (!txHex) throw new Error(`Error: txHex not found`);
      const { tx, txId } = transactionFromHex(txHex);

      const ins = tx.ins.map(input => {
        const prevTxId = buf2RevHex(input.hash);
        const prevVout = input.index;
        const prevTxo: Utxo = `${prevTxId}:${prevVout}`;
        const ownedPrevTxo: Utxo | false = txoSet.has(prevTxo)
          ? prevTxo
          : false;
        if (ownedPrevTxo) {
          const prevTxHex = txMap[prevTxId]?.txHex;
          if (!prevTxHex) throw new Error(`txHex not set for ${prevTxId}`);
          const { tx: prevTx } = transactionFromHex(prevTxHex);
          const value = prevTx.outs[prevVout]?.value;
          if (value === undefined)
            throw new Error(`value should exist for ${prevTxId}:${prevVout}`);
          return { ownedPrevTxo, value };
        } else return { ownedPrevTxo };
      });
      const outs = tx.outs.map((output, vout) => {
        const txo = `${txId}:${vout}`;
        const value = output.value;
        const ownedTxo: Utxo | false = txoSet.has(txo) ? txo : false;
        return { ownedTxo, value };
      });
      let netReceived = 0n;
      //What I receive in my descriptors:
      for (const output of outs)
        netReceived += output.ownedTxo ? output.value : 0n;
      //What i send from my descriptors:
      for (const input of ins) {
        if (input.ownedPrevTxo) {
          const value = input.value;
          if (value === undefined)
            throw new Error('input.value should be defined for ownedPrevTxo');
          netReceived -= value;
        }
      }
      const allInputsOwned = ins.every(input => input.ownedPrevTxo);
      const someInputsOwned = ins.some(input => input.ownedPrevTxo);
      const allOutputsOwned = outs.every(output => output.ownedTxo);
      const someOutputsNotOwned = outs.some(output => !output.ownedTxo);
      const someOutputsOwned = outs.some(output => output.ownedTxo);
      const someInputsNotOwned = ins.some(input => !input.ownedPrevTxo);
      let type: 'CONSOLIDATED' | 'RECEIVED' | 'SENT' | 'RECEIVED_AND_SENT';
      if (allInputsOwned && allOutputsOwned) type = 'CONSOLIDATED';
      else if (
        someInputsNotOwned &&
        someInputsOwned &&
        someOutputsNotOwned &&
        someOutputsOwned
      )
        type = 'RECEIVED_AND_SENT';
      else if (someInputsOwned && someOutputsNotOwned) type = 'SENT';
      else if (someInputsNotOwned && someOutputsOwned) type = 'RECEIVED';
      else throw new Error('Transaction type could not be determined.');

      return {
        ins,
        outs,
        netReceived,
        type,
        txId,
        irreversible,
        blockHeight
      };
    });
  };

  const deriveHistoryByOutputFactory = memoizee(
    (withAttributions: boolean) =>
      memoizee(
        (networkId: NetworkId) =>
          memoizee(
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
                          const txAllHistory = deriveTxDataArray(
                            txMap,
                            descriptorMap,
                            descriptor,
                            index
                          );
                          const txHistory = txAllHistory.filter(
                            txData =>
                              txStatus === TxStatus.ALL ||
                              (txStatus === TxStatus.IRREVERSIBLE &&
                                txData.irreversible) ||
                              (txStatus === TxStatus.CONFIRMED &&
                                txData.blockHeight !== 0)
                          );
                          const sortedHistory = txHistory.sort(compareTxOrder);
                          if (withAttributions)
                            return deriveAttributions(
                              sortedHistory,
                              networkId,
                              txMap,
                              descriptorMap,
                              descriptor,
                              txStatus
                            );
                          else return sortedHistory;
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
          ),
        { primitive: true } //unbounced cache for networkId
      ),
    { primitive: true } //unbounded cache (no max setting) since withAttributions is space is 2
  );

  const deriveHistoryByOutput = (
    withAttributions: boolean,
    networkId: NetworkId,
    txMap: Record<TxId, TxData>,
    descriptorMap: Record<Descriptor, DescriptorData>,
    descriptor: Descriptor,
    index: DescriptorIndex,
    txStatus: TxStatus
  ) =>
    deriveHistoryByOutputFactory(withAttributions)(networkId)(txStatus)(
      descriptor
    )(index)(txMap, descriptorMap);

  const coreDeriveHistory = (
    withAttributions: boolean,
    networkId: NetworkId,
    descriptorMap: Record<Descriptor, DescriptorData>,
    txMap: Record<TxId, TxData>,
    descriptorOrDescriptors: Array<Descriptor> | Descriptor,
    txStatus: TxStatus
  ): Array<TxData> | Array<TxAttribution> => {
    const txHistory: Array<TxData> = [];
    const descriptorArray = Array.isArray(descriptorOrDescriptors)
      ? descriptorOrDescriptors
      : [descriptorOrDescriptors];
    for (const descriptor of descriptorArray) {
      const range = deriveUsedRange(descriptorMap[descriptor]);
      Object.keys(range)
        .sort() //Sort it to be deterministic
        .forEach(indexStr => {
          const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
          txHistory.push(
            ...deriveHistoryByOutput(
              //Derive the normal txHistory without attributions (false).
              //This will be enhanced later if withAttributions is set.
              //Note that deriveAttributions uses txHistory (normal history)
              //as input
              false,
              networkId,
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
    const dedupedHistory = [...new Set(txHistory)];
    //since we have txs belonging to different expressions let's try to order
    //them from old to new (blockHeight ascending order).
    //Note that we cannot guarantee to keep correct order to txs
    //that belong to the same blockHeight except when one of the txs depends
    //on the other.
    //See https://github.com/Blockstream/esplora/issues/165#issuecomment-1584471718
    const sortedHistory = dedupedHistory.sort(compareTxOrder);

    if (withAttributions)
      return deriveAttributions(
        sortedHistory,
        networkId,
        txMap,
        descriptorMap,
        descriptorOrDescriptors,
        txStatus
      );
    else return sortedHistory;
  };

  const deriveHistoryFactory = memoizee(
    (withAttributions: boolean) =>
      memoizee(
        (networkId: NetworkId) =>
          memoizee(
            (txStatus: TxStatus) =>
              memoizee(
                (descriptorOrDescriptors: Array<Descriptor> | Descriptor) => {
                  return memoizeOneWithShallowArraysCheck(
                    (
                      txMap: Record<TxId, TxData>,
                      descriptorMap: Record<Descriptor, DescriptorData>
                    ) =>
                      coreDeriveHistory(
                        withAttributions,
                        networkId,
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
          ),
        { primitive: true } //unbounded cache for NetworkId
      ),
    { primitive: true } //unbounded cache (no max setting) since withAttributions is space is 2
  );
  const deriveHistory = (
    withAttributions: boolean,
    networkId: NetworkId,
    txMap: Record<TxId, TxData>,
    descriptorMap: Record<Descriptor, DescriptorData>,
    descriptorOrDescriptors: Array<Descriptor> | Descriptor,
    txStatus: TxStatus
  ) =>
    deriveHistoryFactory(withAttributions)(networkId)(txStatus)(
      descriptorOrDescriptors
    )(txMap, descriptorMap);

  const coreDeriveTxos = (
    networkId: NetworkId,
    descriptorMap: Record<Descriptor, DescriptorData>,
    txMap: Record<TxId, TxData>,
    descriptorOrDescriptors: Array<Descriptor> | Descriptor,
    txStatus: TxStatus
  ): { utxos: Array<Utxo>; stxos: Array<Stxo>; txoMap: TxoMap } => {
    const utxos: Utxo[] = [];
    const stxos: Stxo[] = [];
    const txoMap: TxoMap = {};
    const descriptorArray = Array.isArray(descriptorOrDescriptors)
      ? descriptorOrDescriptors
      : [descriptorOrDescriptors];
    for (const descriptor of descriptorArray) {
      const range = deriveUsedRange(descriptorMap[descriptor]);
      Object.keys(range)
        .sort() //Sort it to be deterministic
        .forEach(indexStr => {
          const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
          const {
            utxos: utxosByO,
            stxos: stxosByO,
            txoMap: txoMapByO
          } = deriveUtxosAndBalanceByOutput(
            networkId,
            txMap,
            descriptorMap,
            descriptor,
            index,
            txStatus
          );
          utxos.push(...utxosByO);
          stxos.push(...stxosByO);
          Object.assign(txoMap, txoMapByO);
        });
    }
    //Deduplicate in case of expression: Array<Descriptor> with duplicated
    //descriptorOrDescriptors
    const dedupedUtxos = [...new Set(utxos)];
    const dedupedStxos = [...new Set(stxos)];
    return { utxos: dedupedUtxos, stxos: dedupedStxos, txoMap };
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
              let lastTxoMap: TxoMap | null = null;
              let lastUtxos: Array<Utxo> | null = null;
              let lastStxos: Array<Stxo> | null = null;
              let lastBalance: bigint;
              return memoizee(
                (
                  txMap: Record<TxId, TxData>,
                  descriptorMap: Record<Descriptor, DescriptorData>
                ) => {
                  let { utxos, stxos, txoMap } = coreDeriveTxos(
                    networkId,
                    descriptorMap,
                    txMap,
                    descriptorOrDescriptors,
                    txStatus
                  );
                  let balance: bigint;
                  if (lastTxoMap && shallowEqualObjects(lastTxoMap, txoMap))
                    txoMap = lastTxoMap;
                  if (lastStxos && shallowEqualArrays(lastStxos, stxos))
                    stxos = lastStxos;
                  if (lastUtxos && shallowEqualArrays(lastUtxos, utxos)) {
                    utxos = lastUtxos;
                    balance = lastBalance;
                  } else balance = coreDeriveUtxosBalance(txMap, utxos);

                  lastTxoMap = txoMap;
                  lastUtxos = utxos;
                  lastStxos = stxos;
                  lastBalance = balance;
                  return { stxos, utxos, txoMap, balance };
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

  const transactionFromHex = memoizee(
    (txHex: string) => {
      const tx = Transaction.fromHex(txHex);
      const txId = tx.getId();
      return { tx, txId };
    },
    {
      primitive: true,
      max: 1000
    }
  );
  const hex2RevBuf = memoizee(
    (idOrHash: string) => {
      return fromHex(idOrHash).reverse();
    },
    {
      primitive: true,
      max: 1000
    }
  );
  const buf2RevHex = memoizee(
    (idOrHash: Uint8Array) => {
      //Note we create a new Uint8Array since reverse() mutates the input
      return toHex(Uint8Array.from(idOrHash).reverse());
    },
    {
      primitive: true,
      max: 1000
    }
  );

  const coreDeriveUtxosBalance = (
    txMap: Record<TxId, TxData>,
    utxos: Array<Utxo>
  ): bigint => {
    let balance = 0n;

    const firstDuplicate = utxos.find((element, index, arr) => {
      return arr.indexOf(element) !== index;
    });
    if (firstDuplicate !== undefined)
      throw new Error(`Duplicated utxo: ${firstDuplicate}`);

    for (const utxo of utxos) {
      const [txId, voutStr] = utxo.split(':');
      if (txId === undefined || voutStr === undefined)
        throw new Error(`Undefined txId or vout for UTXO: ${utxo}`);
      const vout = parseInt(voutStr);

      const txData = txMap[txId];
      if (!txData)
        throw new Error(`txData not saved for ${txId}, vout:${vout} - ${utxo}`);
      const txHex = txData.txHex;
      if (!txHex) throw new Error(`txHex not yet retrieved for ${txId}`);
      const { tx } = transactionFromHex(txHex);
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
    transactionFromHex,
    compareTxOrder
  };
}
