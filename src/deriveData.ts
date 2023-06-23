//Note that txInfoArray cannot be assumed to be in correct order. See:
//https://github.com/Blockstream/esplora/issues/165#issuecomment-1584471718

//Note: we use get*() for functions that compute things (not using discoveryInfo)
//We use derive*() for functions that derive discoveryInfo

//TODO: add constants for max: 100, max: 1000. also don't use a fixed but
//MAX_SPACE_PER_EXPRESSION=1000, MAX_SPACE_PER_NETWORK = 3, MAX_SPACE_PER_WALLET=100,... and then multiply
//The constants above should be configurable through constructor
//TODO: review all memoizee and see if primitive possible in some that was not pu
//TODO: The network is not relevant for getScriptPubKey. Using this fact simplifies
//greatly everything
const MAX_EXPRESSIONS_PER_NETWORK = 1000;
import memoizee from 'memoizee';
import { memoizeOneWithShallowArraysCheck } from './memoizers';
import { shallowEqualArrays } from 'shallow-equal';
import {
  NetworkId,
  ScriptPubKeyInfo,
  Expression,
  DescriptorIndex,
  DiscoveryInfo,
  Utxo,
  TxStatus,
  DescriptorInfo,
  TxId,
  TxInfo
} from './types';
import { Transaction } from 'bitcoinjs-lib';
import { DescriptorsFactory } from '@bitcoinerlab/descriptors';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
const { Descriptor, expand } = DescriptorsFactory(secp256k1);
import { getNetwork } from './networks';

//Unbounded even if search space can be infinite. It's worth it.
//TODO: Add more memoization levels. expression should be bound, networkId and index to different bound levels
export const getScriptPubKey = memoizee(
  (expression: Expression, index: DescriptorIndex): Buffer => {
    //Note we don't need to pass a network (bitcoin will be default) but we
    //don't care anyway since the scriptPubKey does not depend on the network
    const descriptor =
      index === 'non-ranged'
        ? new Descriptor({ expression })
        : new Descriptor({ expression, index });
    const scriptPubKey = descriptor.getScriptPubKey();
    return scriptPubKey;
  },
  { primitive: true, max: 1000 }
);

const coreDeriveUtxosByScriptPubKey = (
  expression: Expression,
  index: DescriptorIndex,
  txInfoArray: Array<TxInfo>,
  txStatus: TxStatus
): Array<Utxo> => {
  const scriptPubKey = getScriptPubKey(expression, index);

  const allOutputs: Utxo[] = [];
  const spentOutputs: Utxo[] = [];

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
        if (!input) throw new Error(`Error: invalid input for ${txId}:${vin}`);
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

//TODO: Add more memoizee levels: networkId x txStatus unbounded, expression: 1000?, index: 1000?
const deriveUtxosAndBalanceByScriptPubKeyFactory = memoizee(
  (expression: Expression, index: DescriptorIndex, txStatus: TxStatus) => {
    // Create one function per each expression x index x txStatus
    // coreDeriveUtxosByScriptPubKey shares all params wrt the parent function
    // except for additional param txInfoArray.
    // As soon as txInfoArray in coreDeriveUtxosByScriptPubKey changes, it
    // will resets its memory. However, it always returns the same reference if
    // the resulting array is shallowy-equal:
    const deriveUtxosByScriptPubKey = memoizeOneWithShallowArraysCheck(
      coreDeriveUtxosByScriptPubKey
    );
    let lastUtxos: Array<Utxo> | null = null;
    let lastBalance: number;
    return memoizee(
      (
        txInfoRecords: Record<TxId, TxInfo>,
        descriptors: Record<Expression, DescriptorInfo>
      ) => {
        const scriptPubKeyInfoRecords =
          descriptors[expression]?.scriptPubKeyInfoRecords ||
          ({} as Record<DescriptorIndex, ScriptPubKeyInfo>);
        const txIds = scriptPubKeyInfoRecords[index]?.txIds;
        if (!txIds)
          throw new Error(`txIds not defined for ${expression} and ${index}`);
        const txInfoArray = deriveTxInfoArray(
          txInfoRecords,
          descriptors,
          expression,
          index
        );
        const utxos = deriveUtxosByScriptPubKey(
          expression,
          index,
          txInfoArray,
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
  { primitive: true, max: 1000 }
);

export const deriveUtxosAndBalanceByScriptPubKey = (
  txInfoRecords: Record<TxId, TxInfo>,
  descriptors: Record<Expression, DescriptorInfo>,
  expression: Expression,
  index: DescriptorIndex,
  txStatus: TxStatus
) =>
  deriveUtxosAndBalanceByScriptPubKeyFactory(
    expression,
    index,
    txStatus
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

//TODO: add more memoization levels
const deriveTxInfoArrayFactory = memoizee(
  (expression: Expression, index: DescriptorIndex) => {
    return memoizeOneWithShallowArraysCheck(
      (
        txInfoRecords: Record<TxId, TxInfo>,
        descriptors: Record<Expression, DescriptorInfo>
      ) => {
        const scriptPubKeyInfoRecords =
          descriptors[expression]?.scriptPubKeyInfoRecords ||
          ({} as Record<DescriptorIndex, ScriptPubKeyInfo>);
        const txIds = scriptPubKeyInfoRecords[index]?.txIds;
        if (!txIds)
          throw new Error(`txIds not defined for ${expression} and ${index}`);
        const txInfoArray = coreDeriveTxInfoArray(txIds, txInfoRecords);
        return txInfoArray;
      }
    );
  },
  { primitive: true, max: 1000 }
);

const deriveTxInfoArray = (
  txInfoRecords: Record<TxId, TxInfo>,
  descriptors: Record<Expression, DescriptorInfo>,
  expression: Expression,
  index: DescriptorIndex
) => deriveTxInfoArrayFactory(expression, index)(txInfoRecords, descriptors);

const coreDeriveUtxosByExpressions = (
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
        const txIds = scriptPubKeyInfoRecords[index]?.txIds;
        if (!txIds)
          throw new Error(`txIds not defined for ${expression} and ${index}`);
        utxos.push(
          ...deriveUtxosAndBalanceByScriptPubKey(
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

//unbounded memoizee wrt NetworkId x TxStatus is fine since it has a small Search Space
//however the search space for expressions must be bounded
//returns {balance, utxos}. The reference of utxos will be kept the same for
//each tuple of txStatus x expressions
const deriveUtxosAndBalanceByExpressionsFactory = memoizee(
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
      { max: 100, primitive: true } //potentially ininite search space. limit to 100 expressions per txStatus combination
    ),
  { primitive: true } //unbounded cache (no max setting) since Search Space is small
);

export const deriveUtxosAndBalanceByExpressions = (
  txInfoRecords: Record<TxId, TxInfo>,
  descriptors: Record<Expression, DescriptorInfo>,
  expressions: Array<Expression> | Expression,
  txStatus: TxStatus
) =>
  deriveUtxosAndBalanceByExpressionsFactory(txStatus)(expressions)(
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
  scriptPubKeyInfoRecords: Record<DescriptorIndex, ScriptPubKeyInfo> | undefined
) {
  if (scriptPubKeyInfoRecords === undefined) return false;
  for (const prop in scriptPubKeyInfoRecords)
    if (Object.prototype.hasOwnProperty.call(scriptPubKeyInfoRecords, prop))
      return true;
  return false;
}

//TODO: redo this not to depend on discoveryInfo
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


//TODO: refactor this not to depend on discoveryInfo
const deriveExpressionsFactory = memoizee(
  (networkId: NetworkId) => {
    return memoizeOneWithShallowArraysCheck((discoveryInfo: DiscoveryInfo) =>
      coreDeriveExpressions(discoveryInfo, networkId)
    );
  },
  { primitive: true }
);

/* returns the descriptors expressions that have at least one scriptPubKey that
 * has been used
 * It always returns the same Array object per each networkId if the result
 * never changes*/
//TODO: redo ths not to depende on discoveryInfo
export const deriveExpressions = (
  discoveryInfo: DiscoveryInfo,
  networkId: NetworkId
) => deriveExpressionsFactory(networkId)(discoveryInfo);

const coreDeriveWallets = (
  networkId: NetworkId,
  expressions: Array<Expression>
): Array<Array<Expression>> => {
  const network = getNetwork(networkId);
  const expandedDescriptors = expressions.map(expression => ({
    expression,
    ...expand({ expression, network })
  }));
  const hashMap: Record<
    string,
    Array<{ expression: string; keyPath: string }>
  > = {};

  for (const expandedDescriptor of expandedDescriptors) {
    const { expression, expandedExpression, expansionMap } = expandedDescriptor;

    let wildcardCount = 0;
    for (const key in expansionMap) {
      const keyInfo = expansionMap[key];
      if (!keyInfo)
        throw new Error(`keyInfo not defined for key ${key} in ${expression}`);
      if (keyInfo.keyPath?.indexOf('*') !== -1) wildcardCount++;
      if (wildcardCount > 1)
        throw new Error(`Error: invalid >1 range: ${expression}`);

      if (keyInfo.keyPath === '/0/*' || keyInfo.keyPath === '/1/*') {
        const masterFingerprint = keyInfo.masterFingerprint;
        if (!masterFingerprint)
          throw new Error(
            `Error: ranged descriptor ${expression} without masterFingerprint`
          );
        //Group them based on info up to before the change level:
        const hashKey = `${expandedExpression}-${key}-${masterFingerprint.toString(
          'hex'
        )}-${keyInfo.originPath}`;

        const hashValue = (hashMap[hashKey] = hashMap[hashKey] || []);
        hashValue.push({ expression, keyPath: keyInfo.keyPath });
      }
    }
  }

  //Detect & throw errors. Also sort all arrays so that they always return same
  //(deep) object. This will be convenient when using memoizeOneWithDeepCheck
  Object.values(hashMap)
    .sort()
    .forEach(descriptorArray => {
      descriptorArray.sort();
      if (descriptorArray.length === 0)
        throw new Error(`hashMap created without any valid record`);
      if (descriptorArray.length > 2)
        throw new Error(`Error: >2 ranged descriptors for the same wallet`);

      const keyPaths = descriptorArray.map(d => d.keyPath);
      if (keyPaths.length === 1)
        if (!keyPaths.includes('/0/*') && !keyPaths.includes('/1/*'))
          throw new Error(`Error: invalid single keyPath`);
      if (keyPaths.length === 2)
        if (!keyPaths.includes('/0/*') || !keyPaths.includes('/1/*'))
          throw new Error(`Error: unpaired keyPaths`);
    });

  const wallets = Object.values(hashMap).map(descriptorArray =>
    descriptorArray.map(d => d.expression)
  );
  return wallets;
};

/** Definition :A Wallet is an array of 1 or 2 descriptor expressions.
 * Wallet descriptor expressions are those that share the same pattern except
 * their keyInfo which may return with /0/* and/or /1/*
 *
 * Given a ser of expressions, this function returns all wallets.
 *
 * The function will return the same Array of Arrays object if the deep object
 * did not change.
 *
 */
const deriveWalletsFactory = memoizee(
  (networkId: NetworkId) =>
    memoizee(
      (expressions: Array<Expression>) =>
        coreDeriveWallets(networkId, expressions),
      { primitive: true, max: MAX_EXPRESSIONS_PER_NETWORK }
    ),
  { primitive: true }
);

export const deriveWallets = (
  networkId: NetworkId,
  expressions: Array<Expression>
) => deriveWalletsFactory(networkId)(expressions);
