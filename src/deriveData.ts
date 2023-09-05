// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

import memoizee from 'memoizee';
import { memoizeOneWithShallowArraysCheck } from './memoizers';
import { shallowEqualArrays } from 'shallow-equal';
import {
  NetworkId,
  ScriptPubKeyInfo,
  Expression,
  Account,
  DescriptorIndex,
  DiscoveryInfo,
  Utxo,
  TxStatus,
  DescriptorInfo,
  TxId,
  TxInfo
} from './types';
import { Transaction, Network } from 'bitcoinjs-lib';
import { DescriptorsFactory } from '@bitcoinerlab/descriptors';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
const { Descriptor, expand } = DescriptorsFactory(secp256k1);
import { getNetwork } from './networks';

export const canonicalize = (
  expressions: Array<Expression> | Expression,
  network: Network
) => {
  let isDifferent = false;
  const expressionArray = Array.isArray(expressions)
    ? expressions
    : [expressions];
  const canonicalExpressions: Array<Expression> | Expression = [];
  expressionArray.forEach(expression => {
    const canonicalExpression = expand({
      expression,
      network
    }).canonicalExpression;
    if (expression !== canonicalExpression) isDifferent = true;
    canonicalExpressions.push(canonicalExpression);
  });
  if (isDifferent) return canonicalExpressions;
  else return expressions;
};

export function deriveDataFactory({
  expressionsCacheSize = 0,
  indicesPerExpressionCacheSize = 0
}: {
  expressionsCacheSize: number;
  indicesPerExpressionCacheSize: number;
}) {
  const deriveScriptPubKeyFactory = memoizee(
    (networkId: NetworkId) =>
      memoizee(
        (expression: Expression) =>
          memoizee(
            (index: DescriptorIndex) => {
              const network = getNetwork(networkId);
              //Note there is no need to pass a network (bitcoin will be default) but
              //it's not important anyway since the scriptPubKey does not depend on
              //the network
              const descriptor =
                index === 'non-ranged'
                  ? new Descriptor({ expression, network })
                  : new Descriptor({ expression, index, network });
              const scriptPubKey = descriptor.getScriptPubKey();
              return scriptPubKey;
            },
            { primitive: true, max: indicesPerExpressionCacheSize }
          ),
        { primitive: true, max: expressionsCacheSize }
      ),
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );
  const deriveScriptPubKey = (
    networkId: NetworkId,
    expression: Expression,
    index: DescriptorIndex
  ) => deriveScriptPubKeyFactory(networkId)(expression)(index);

  const coreDeriveUtxosByScriptPubKey = (
    networkId: NetworkId,
    expression: Expression,
    index: DescriptorIndex,
    txInfoArray: Array<TxInfo>,
    txStatus: TxStatus
  ): Array<Utxo> => {
    const scriptPubKey = deriveScriptPubKey(networkId, expression, index);

    const allOutputs: Utxo[] = [];
    const spentOutputs: Utxo[] = [];

    //Note that txInfoArray cannot be assumed to be in correct order. See:
    //https://github.com/Blockstream/esplora/issues/165#issuecomment-1584471718
    for (const txInfo of txInfoArray) {
      if (
        txStatus === TxStatus.ALL ||
        (txStatus === TxStatus.IRREVERSIBLE && txInfo.irreversible) ||
        (txStatus === TxStatus.CONFIRMED && txInfo.blockHeight !== 0)
      ) {
        const txHex = txInfo.txHex;
        if (!txHex)
          throw new Error(
            `txHex not yet retrieved for an element of ${expression}, ${index}`
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

  const deriveUtxosAndBalanceByScriptPubKeyFactory = memoizee(
    (networkId: NetworkId) =>
      memoizee(
        (txStatus: TxStatus) =>
          memoizee(
            (expression: Expression) =>
              memoizee(
                (index: DescriptorIndex) => {
                  // Create one function per each expression x index x txStatus
                  // coreDeriveUtxosByScriptPubKey shares all params wrt the parent
                  // function except for additional param txInfoArray.
                  // As soon as txInfoArray in coreDeriveUtxosByScriptPubKey changes,
                  // it will resets its memory. However, it always returns the same
                  // reference if the resulting array is shallowy-equal:
                  const deriveUtxosByScriptPubKey =
                    memoizeOneWithShallowArraysCheck(
                      coreDeriveUtxosByScriptPubKey
                    );
                  let lastUtxos: Array<Utxo> | null = null;
                  let lastBalance: number;
                  return memoizee(
                    (
                      txInfoRecords: Record<TxId, TxInfo>,
                      descriptors: Record<Expression, DescriptorInfo>
                    ) => {
                      const txInfoArray = deriveTxInfoArray(
                        txInfoRecords,
                        descriptors,
                        expression,
                        index
                      );
                      const utxos = deriveUtxosByScriptPubKey(
                        networkId,
                        expression,
                        index,
                        txInfoArray,
                        txStatus
                      );
                      if (lastUtxos && shallowEqualArrays(lastUtxos, utxos))
                        return { utxos: lastUtxos, balance: lastBalance };
                      lastUtxos = utxos;
                      lastBalance = coreDeriveUtxosBalance(
                        txInfoRecords,
                        utxos
                      );
                      return { utxos, balance: lastBalance };
                    },
                    { max: 1 }
                  );
                },
                { primitive: true, max: indicesPerExpressionCacheSize }
              ),
            { primitive: true, max: expressionsCacheSize }
          ),
        { primitive: true } //unbounded cache (no max setting) since Search Space is small
      ),
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );

  const deriveUtxosAndBalanceByScriptPubKey = (
    networkId: NetworkId,
    txInfoRecords: Record<TxId, TxInfo>,
    descriptors: Record<Expression, DescriptorInfo>,
    expression: Expression,
    index: DescriptorIndex,
    txStatus: TxStatus
  ) =>
    deriveUtxosAndBalanceByScriptPubKeyFactory(networkId)(txStatus)(expression)(
      index
    )(txInfoRecords, descriptors);

  const coreDeriveTxInfoArray = (
    txIds: Array<TxId>,
    txInfoRecords: Record<TxId, TxInfo>
  ): Array<TxInfo> =>
    txIds.map(txId => {
      const txInfo = txInfoRecords[txId];
      if (!txInfo) throw new Error(`txInfo not saved for ${txId}`);
      return txInfo;
    });

  const deriveTxInfoArrayFactory = memoizee(
    (expression: Expression) =>
      memoizee(
        (index: DescriptorIndex) => {
          return memoizeOneWithShallowArraysCheck(
            (
              txInfoRecords: Record<TxId, TxInfo>,
              descriptors: Record<Expression, DescriptorInfo>
            ) => {
              const scriptPubKeyInfoRecords =
                descriptors[expression]?.scriptPubKeyInfoRecords ||
                ({} as Record<DescriptorIndex, ScriptPubKeyInfo>);
              const txIds = scriptPubKeyInfoRecords[index]?.txIds || [];
              const txInfoArray = coreDeriveTxInfoArray(txIds, txInfoRecords);
              return txInfoArray;
            }
          );
        },
        { primitive: true, max: indicesPerExpressionCacheSize }
      ),
    { primitive: true, max: expressionsCacheSize }
  );

  const deriveTxInfoArray = (
    txInfoRecords: Record<TxId, TxInfo>,
    descriptors: Record<Expression, DescriptorInfo>,
    expression: Expression,
    index: DescriptorIndex
  ) => deriveTxInfoArrayFactory(expression)(index)(txInfoRecords, descriptors);

  const deriveHistoryByScriptPubKeyFactory = memoizee(
    (txStatus: TxStatus) =>
      memoizee(
        (expression: Expression) =>
          memoizee(
            (index: DescriptorIndex) => {
              return memoizeOneWithShallowArraysCheck(
                (
                  txInfoRecords: Record<TxId, TxInfo>,
                  descriptors: Record<Expression, DescriptorInfo>
                ) => {
                  const txInfoArray = deriveTxInfoArray(
                    txInfoRecords,
                    descriptors,
                    expression,
                    index
                  );
                  return txInfoArray.filter(
                    txInfo =>
                      txStatus === TxStatus.ALL ||
                      (txStatus === TxStatus.IRREVERSIBLE &&
                        txInfo.irreversible) ||
                      (txStatus === TxStatus.CONFIRMED &&
                        txInfo.blockHeight !== 0)
                  );
                }
              );
            },
            {
              primitive: true,
              max: indicesPerExpressionCacheSize
            }
          ),
        { primitive: true, max: expressionsCacheSize }
      ),
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );
  const deriveHistoryByScriptPubKey = (
    txInfoRecords: Record<TxId, TxInfo>,
    descriptors: Record<Expression, DescriptorInfo>,
    expression: Expression,
    index: DescriptorIndex,
    txStatus: TxStatus
  ) =>
    deriveHistoryByScriptPubKeyFactory(txStatus)(expression)(index)(
      txInfoRecords,
      descriptors
    );

  const coreDeriveHistory = (
    descriptors: Record<Expression, DescriptorInfo>,
    txInfoRecords: Record<TxId, TxInfo>,
    expressions: Array<Expression> | Expression,
    txStatus: TxStatus
  ): Array<TxInfo> => {
    const history: Array<TxInfo> = [];
    const expressionArray = Array.isArray(expressions)
      ? expressions
      : [expressions];
    for (const expression of expressionArray) {
      const scriptPubKeyInfoRecords =
        descriptors[expression]?.scriptPubKeyInfoRecords ||
        ({} as Record<DescriptorIndex, ScriptPubKeyInfo>);
      Object.keys(scriptPubKeyInfoRecords)
        .sort() //Sort it to be deterministic
        .forEach(indexStr => {
          const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
          history.push(
            ...deriveHistoryByScriptPubKey(
              txInfoRecords,
              descriptors,
              expression,
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
    return dedupedHistory.sort(
      (txInfoA, txInfoB) => txInfoA.blockHeight - txInfoB.blockHeight
    );
  };

  const deriveHistoryFactory = memoizee(
    (txStatus: TxStatus) =>
      memoizee(
        (expressions: Array<Expression> | Expression) => {
          return memoizeOneWithShallowArraysCheck(
            (
              txInfoRecords: Record<TxId, TxInfo>,
              descriptors: Record<Expression, DescriptorInfo>
            ) =>
              coreDeriveHistory(
                descriptors,
                txInfoRecords,
                expressions,
                txStatus
              )
          );
        },
        { primitive: true, max: expressionsCacheSize }
      ),
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );
  const deriveHistory = (
    txInfoRecords: Record<TxId, TxInfo>,
    descriptors: Record<Expression, DescriptorInfo>,
    expressions: Array<Expression> | Expression,
    txStatus: TxStatus
  ) => deriveHistoryFactory(txStatus)(expressions)(txInfoRecords, descriptors);

  const coreDeriveUtxosByExpressions = (
    networkId: NetworkId,
    descriptors: Record<Expression, DescriptorInfo>,
    txInfoRecords: Record<TxId, TxInfo>,
    expressions: Array<Expression> | Expression,
    txStatus: TxStatus
  ): Array<Utxo> => {
    const utxos: Utxo[] = [];
    const expressionArray = Array.isArray(expressions)
      ? expressions
      : [expressions];
    for (const expression of expressionArray) {
      const scriptPubKeyInfoRecords =
        descriptors[expression]?.scriptPubKeyInfoRecords ||
        ({} as Record<DescriptorIndex, ScriptPubKeyInfo>);
      Object.keys(scriptPubKeyInfoRecords)
        .sort() //Sort it to be deterministic
        .forEach(indexStr => {
          const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
          utxos.push(
            ...deriveUtxosAndBalanceByScriptPubKey(
              networkId,
              txInfoRecords,
              descriptors,
              expression,
              index,
              txStatus
            ).utxos
          );
        });
    }
    //Deduplicate in case of expression: Array<Expression> with duplicated
    //expressions
    const dedupedUtxos = [...new Set(utxos)];
    return dedupedUtxos;
  };

  //unbound memoizee wrt TxStatus is fine since it has a small Search Space
  //however the search space for expressions must be bounded
  //returns {balance, utxos}. The reference of utxos will be kept the same for
  //each tuple of txStatus x expressions
  const deriveUtxosAndBalanceByExpressionsFactory = memoizee(
    (networkId: NetworkId) =>
      memoizee(
        (txStatus: TxStatus) =>
          memoizee(
            (expressions: Array<Expression> | Expression) => {
              let lastUtxos: Array<Utxo> | null = null;
              let lastBalance: number;
              return memoizee(
                (
                  txInfoRecords: Record<TxId, TxInfo>,
                  descriptors: Record<Expression, DescriptorInfo>
                ) => {
                  const utxos = coreDeriveUtxosByExpressions(
                    networkId,
                    descriptors,
                    txInfoRecords,
                    expressions,
                    txStatus
                  );
                  if (lastUtxos && shallowEqualArrays(lastUtxos, utxos))
                    return { utxos: lastUtxos, balance: lastBalance };
                  lastUtxos = utxos;
                  lastBalance = coreDeriveUtxosBalance(txInfoRecords, utxos);
                  return { utxos, balance: lastBalance };
                },
                { max: 1 }
              );
            },
            { primitive: true, max: expressionsCacheSize } //potentially ininite search space. limit to 100 expressions per txStatus combination
          ),
        { primitive: true } //unbounded cache (no max setting) since Search Space is small
      ),
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );

  const deriveUtxosAndBalanceByExpressions = (
    networkId: NetworkId,
    txInfoRecords: Record<TxId, TxInfo>,
    descriptors: Record<Expression, DescriptorInfo>,
    expressions: Array<Expression> | Expression,
    txStatus: TxStatus
  ) =>
    deriveUtxosAndBalanceByExpressionsFactory(networkId)(txStatus)(expressions)(
      txInfoRecords,
      descriptors
    );

  const transactionFromHex = memoizee(Transaction.fromHex, {
    primitive: true,
    max: 1000
  });

  const coreDeriveUtxosBalance = (
    txInfoRecords: Record<TxId, TxInfo>,
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

      const txInfo = txInfoRecords[txId];
      if (!txInfo)
        throw new Error(`txInfo not saved for ${txId}, vout:${vout} - ${utxo}`);
      const txHex = txInfo.txHex;
      if (!txHex) throw new Error(`txHex not yet retrieved for ${txId}`);
      const tx = transactionFromHex(txHex);
      const output = tx.outs[vout];
      if (!output) throw new Error(`Error: invalid output for ${txId}:${vout}`);
      const outputValue = output.value; // value in satoshis
      balance += outputValue;
    }
    return balance;
  };

  function scriptPubKeyHasRecords(
    scriptPubKeyInfoRecords:
      | Record<DescriptorIndex, ScriptPubKeyInfo>
      | undefined
  ) {
    if (scriptPubKeyInfoRecords === undefined) return false;
    for (const prop in scriptPubKeyInfoRecords)
      if (Object.prototype.hasOwnProperty.call(scriptPubKeyInfoRecords, prop))
        return true;
    return false;
  }

  const coreDeriveExpressions = (
    discoveryInfo: DiscoveryInfo,
    networkId: NetworkId
  ) => {
    const descriptors = discoveryInfo[networkId].descriptors;
    return Object.keys(descriptors)
      .filter(expression =>
        scriptPubKeyHasRecords(descriptors[expression]?.scriptPubKeyInfoRecords)
      )
      .sort();
  };

  const deriveExpressionsFactory = memoizee(
    (networkId: NetworkId) => {
      return memoizeOneWithShallowArraysCheck((discoveryInfo: DiscoveryInfo) =>
        coreDeriveExpressions(discoveryInfo, networkId)
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
   * @param {DiscoveryInfo} discoveryInfo - Information regarding discovery.
   * @param {NetworkId} networkId - The network identifier.
   * @returns {Array<Expression>} - Descriptor expressions.
   */
  const deriveExpressions = (
    discoveryInfo: DiscoveryInfo,
    networkId: NetworkId
  ) => deriveExpressionsFactory(networkId)(discoveryInfo);

  /**
   * Derives the accounts from the discoveryInfo.
   * Descriptor expressions of an account share the same pattern, except for
   * their keyInfo, which can end with either /0/* or /1/*.
   * An Account is represented by its external descriptor.
   *
   * @param {NetworkId} networkId
   * @returns {Array<Account>}- Returns an array of accounts.
   */
  const coreDeriveAccounts = (
    discoveryInfo: DiscoveryInfo,
    networkId: NetworkId
  ): Array<Account> => {
    const expressions = coreDeriveExpressions(discoveryInfo, networkId);
    const accounts: Array<Account> = [];

    const network = getNetwork(networkId);
    const expandedDescriptors = expressions.map(expression => ({
      expression,
      ...expand({ expression, network })
    }));
    for (const { expression, expansionMap } of expandedDescriptors) {
      for (const key in expansionMap) {
        const keyInfo = expansionMap[key];
        if (!keyInfo)
          throw new Error(
            `keyInfo not defined for key ${key} in ${expression}`
          );

        if (keyInfo.keyPath === '/0/*' || keyInfo.keyPath === '/1/*') {
          const account = expression.replace(/\/1\/\*/g, '/0/*');
          if (!accounts.includes(account)) accounts.push(account);
        }
      }
    }
    return accounts.sort(); //So it's deterministic
  };

  const deriveAccountsFactory = memoizee(
    (networkId: NetworkId) => {
      return memoizeOneWithShallowArraysCheck((discoveryInfo: DiscoveryInfo) =>
        coreDeriveAccounts(discoveryInfo, networkId)
      );
    },
    { primitive: true } //unbounded cache (no max setting) since Search Space is small
  );

  const deriveAccounts = (discoveryInfo: DiscoveryInfo, networkId: NetworkId) =>
    deriveAccountsFactory(networkId)(discoveryInfo);

  const deriveAccountExpressions = memoizee(
    (account: Account) => [account, account.replace(/\/0\/\*/g, '/1/*')],
    { primitive: true, max: expressionsCacheSize }
  );

  return {
    deriveScriptPubKey,
    deriveUtxosAndBalanceByScriptPubKey,
    deriveUtxosAndBalanceByExpressions,
    deriveExpressions,
    deriveAccounts,
    deriveAccountExpressions,
    deriveHistoryByScriptPubKey,
    deriveHistory,
    transactionFromHex
  };
}
