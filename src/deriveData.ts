//Note that txInfoArray cannot be assumed to be in correct order. See:
//https://github.com/Blockstream/esplora/issues/165#issuecomment-1584471718
import memoizee from 'memoizee';

import { shallowEqualArrays } from 'shallow-equal';
import {
  NetworkId,
  ScriptPubKeyInfo,
  Expression,
  DescriptorIndex,
  DiscoveryInfo,
  Utxo,
  TxStatus
} from './types';
import { Network, Transaction, networks } from 'bitcoinjs-lib';
import { DescriptorsFactory } from '@bitcoinerlab/descriptors';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
const { Descriptor, expand } = DescriptorsFactory(secp256k1);

/**
 * This function is an extension of memoizee which stores the result of the latest call (cache size one).
 * If the arguments for the current call are the same as the latest call, it will return the same result.
 * If the arguments are different, but the returned Array is shallowly equal to the previous one, it still returns the same object.
 *
 * @template T - The type of input arguments to the function to be memoized.
 * @template R - The type of the return value of the function to be memoized.
 * @param {(...args: T) => R} func - The function to be memoized.
 * @returns {(...args: T) => R} A memoized version of the input function.
 *
 * @example
 * const memoizedFunc = memoizeOneWithShallowArraysCheck(myFunc);
 * const result1 = memoizedFunc(arg1, arg2);
 * const result2 = memoizedFunc(arg1, arg2); // Will return the same object as result1
 * const result3 = memoizedFunc(arg3, arg4); // If the result is shallowly equal to result1, it will still return the same object as result1
 */
function memoizeOneWithShallowArraysCheck<
  T extends unknown[],
  R extends unknown[]
>(func: (...args: T) => R) {
  let lastResult: R | null = null;

  return memoizee(
    (...args: T) => {
      const newResult = func(...args);

      if (lastResult && shallowEqualArrays(lastResult, newResult)) {
        return lastResult;
      }

      lastResult = newResult;
      return newResult;
    },
    { max: 1 }
  );
}

/**
 * This function is an extension of memoizee which stores the result of the latest call (cache size one).
 * If the arguments for the current call are the same as the latest call, it will return the same result.
 * If the arguments are different, but the returned Object or Array is deeply equal to the previous one, it still returns the same object.
 * Note: This uses JSON.stringify for deep comparisons which might not be suitable for large objects or arrays.
 *
 * @template T - The type of input arguments to the function to be memoized.
 * @template R - The type of the return value of the function to be memoized.
 * @param {(...args: T) => R} func - The function to be memoized.
 * @returns {(...args: T) => R} A memoized version of the input function.
 *
 * @example
 * const memoizedFunc = memoizeOneWithDeepCheck(myFunc);
 * const result1 = memoizedFunc(arg1, arg2);
 * const result2 = memoizedFunc(arg1, arg2); // Will return the same object as result1
 * const result3 = memoizedFunc(arg3, arg4); // If the result is deeply equal to result1, it will still return the same object as result1
 */
function memoizeOneWithDeepCheck<T extends unknown[], R extends unknown[]>(
  func: (...args: T) => R
) {
  let lastResult: R | null = null;

  return memoizee(
    (...args: T) => {
      const newResult = func(...args);

      if (
        lastResult &&
        JSON.stringify(lastResult) === JSON.stringify(newResult)
      ) {
        return lastResult;
      }

      lastResult = newResult;
      return newResult;
    },
    { max: 1 }
  );
}

export const getNetworkId = (network: Network): NetworkId => {
  if (network.bech32 === 'bc') return NetworkId.BITCOIN;
  if (network.bech32 === 'bcrt') return NetworkId.REGTEST;
  if (network.bech32 === 'tb') return NetworkId.TESTNET;
  if (network.bech32 === 'sb') return NetworkId.SIGNET;
  throw new Error('Unknown network');
};

const getNetwork = (networkId: NetworkId): Network => {
  if (networkId === NetworkId.BITCOIN) {
    return networks.bitcoin;
  } else if (networkId === NetworkId.REGTEST) {
    return networks.regtest;
  } else if (networkId === NetworkId.TESTNET) {
    return networks.testnet;
  } else if (networkId === NetworkId.SIGNET) {
    //As of June 2023 not part of bitcoinjs-lib
    if (!('signet' in networks)) {
      throw new Error('Signet not implemented yet in bitcoinjs-lib');
    } else return networks.signet as Network;
  } else {
    throw new Error(`Invalid networkId ${networkId}`);
  }
};

export const getScriptPubKey = memoizee(
  function (
    networkId: NetworkId,
    expression: Expression,
    index: DescriptorIndex
  ): Buffer {
    const network = getNetwork(networkId);
    const descriptor =
      index === 'non-ranged'
        ? new Descriptor({ expression, network })
        : new Descriptor({ expression, network, index });
    const scriptPubKey = descriptor.getScriptPubKey();
    return scriptPubKey;
  },
  { primitive: true }
);

const deriveScriptPubKeyInfo = ({
  discoveryInfo,
  networkId,
  expression,
  index
}: {
  discoveryInfo: DiscoveryInfo;
  networkId: NetworkId;
  expression: Expression;
  index: DescriptorIndex;
}): ScriptPubKeyInfo => {
  const scriptPubKeyInfo =
    discoveryInfo[networkId]?.descriptors[expression]?.scriptPubKeyInfoRecords[
      index
    ];

  if (!scriptPubKeyInfo) {
    throw new Error(
      `scriptPubKeyInfo does not exist for ${networkId} ${expression} and ${index}`
    );
  }
  return scriptPubKeyInfo;
};

// memoizee is used here to always get the same selector function
// for the same tuples of networkId+expression+index
const txInfoArrayByScriptPubKeyFactory = memoizee(
  (networkId: NetworkId, expression: Expression, index: DescriptorIndex) => {
    const txInfoMapper = (discoveryInfo: DiscoveryInfo) => {
      const scriptPubKeyInfo = deriveScriptPubKeyInfo({
        discoveryInfo,
        networkId,
        expression,
        index
      });
      return scriptPubKeyInfo.txIds.map(txId => {
        const txInfo = discoveryInfo[networkId].txInfoRecords[txId];
        if (!txInfo) throw new Error(`txInfo not saved for ${txId}`);
        return txInfo;
      });
    };
    return memoizeOneWithShallowArraysCheck(txInfoMapper);
  },
  //Since all the arguments can be converted toString then it's faster using
  //primitive: true
  { primitive: true }
);

const deriveTxInfoArrayByScriptPubKey = (
  discoveryInfo: DiscoveryInfo,
  networkId: NetworkId,
  expression: Expression,
  index: DescriptorIndex
) => {
  // Use the factory function to create the memoized function
  const memoizedFunc = txInfoArrayByScriptPubKeyFactory(
    networkId,
    expression,
    index
  );
  // Call the created function with discoveryInfo
  return memoizedFunc(discoveryInfo);
};

const transactionFromHex = memoizee(Transaction.fromHex, { primitive: true });

// memoizee is used here to always get the same selector function
// for the same tuples of networkId+expression+index+txStatus
const deriveScriptPubKeyUtxosFactory = memoizee(
  (
    networkId: NetworkId,
    expression: Expression,
    index: DescriptorIndex,
    txStatus: TxStatus
  ) => {
    const utxosMapper = (discoveryInfo: DiscoveryInfo) => {
      const txInfoArray = deriveTxInfoArrayByScriptPubKey(
        discoveryInfo,
        networkId,
        expression,
        index
      );

      const scriptPubKey = getScriptPubKey(networkId, expression, index);

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
              `txHex not yet retrieved for an element of ${networkId}, ${expression}, ${index}`
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
              throw new Error(
                `Error: invalid output script for ${txId}:${vout}`
              );
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
    return memoizeOneWithShallowArraysCheck(utxosMapper);
  },
  { primitive: true }
);

export function deriveScriptPubKeyUtxos(
  discoveryInfo: DiscoveryInfo,
  networkId: NetworkId,
  expression: Expression,
  index: DescriptorIndex,
  txStatus: TxStatus
): Utxo[] {
  // Use the factory function to create the memoized function
  const memoizedFunc = deriveScriptPubKeyUtxosFactory(
    networkId,
    expression,
    index,
    txStatus
  );

  // Call the created function with discoveryInfo
  return memoizedFunc(discoveryInfo);
}

const getUtxos = (
  discoveryInfo: DiscoveryInfo,
  expressions: Array<Expression> | Expression,
  networkId: NetworkId,
  txStatus: TxStatus
): Array<Utxo> => {
  const utxos: Utxo[] = [];
  const expressionArray = Array.isArray(expressions)
    ? expressions
    : [expressions];
  const networkInfo = discoveryInfo[networkId];
  for (const expression of expressionArray) {
    const scriptPubKeyInfoRecords =
      networkInfo.descriptors[expression]?.scriptPubKeyInfoRecords || {};
    Object.keys(scriptPubKeyInfoRecords)
      .sort() //Sort it to be deterministic
      .forEach(indexStr => {
        const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
        utxos.push(
          ...deriveScriptPubKeyUtxos(
            discoveryInfo,
            networkId,
            expression,
            index,
            txStatus
          )
        );
      });
  }

  //Deduplucate in case of expression: Array<Expression> with duplicated
  //expressions
  const dedupedUtxos = [...new Set(utxos)];
  return dedupedUtxos;
};

export function deriveUtxos(
  discoveryInfo: DiscoveryInfo,
  expressions: Array<Expression> | Expression,
  networkId: NetworkId,
  txStatus: TxStatus
): Array<Utxo> {
  // Create a factory function memoized with small search space: NetworkId x TxStatus
  const memoizedFunc = memoizee(
    (networkId: NetworkId, txStatus: TxStatus) => {
      const utxosMapper = (
        discoveryInfo: DiscoveryInfo,
        expressions: Expression | Array<Expression>
      ) => getUtxos(discoveryInfo, expressions, networkId, txStatus);

      return memoizeOneWithShallowArraysCheck(utxosMapper); //Since search space of DiscoveryInfo x Expression is large then: memoizeOne
    },
    { primitive: true }
  );
  return memoizedFunc(networkId, txStatus)(discoveryInfo, expressions);
}

export function deriveUtxosBalance(
  utxos: Array<Utxo>,
  discoveryInfo: DiscoveryInfo,
  networkId: NetworkId
): number {
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

    const txInfo = discoveryInfo[networkId].txInfoRecords[txId];
    if (!txInfo)
      throw new Error(`txInfo not saved for ${txId}, vout:${vout} - ${utxo}`);
    const txHex = txInfo.txHex;
    if (!txHex)
      throw new Error(`txHex not yet retrieved for an element of ${networkId}`);
    const tx = transactionFromHex(txHex);
    const output = tx.outs[vout];
    if (!output) throw new Error(`Error: invalid output for ${txId}:${vout}`);
    const outputValue = output.value; // value in satoshis
    balance += outputValue;
  }

  return balance;
}

function scriptPubKeyHasRecords(
  scriptPubKeyInfoRecords: Record<DescriptorIndex, ScriptPubKeyInfo> | undefined
) {
  if (scriptPubKeyInfoRecords === undefined) return false;
  for (const prop in scriptPubKeyInfoRecords)
    if (Object.prototype.hasOwnProperty.call(scriptPubKeyInfoRecords, prop))
      return true;
  return false;
}

const getExpressions = (discoveryInfo: DiscoveryInfo, networkId: NetworkId) => {
  const descriptors = discoveryInfo[networkId].descriptors;
  return Object.keys(descriptors)
    .filter(expression =>
      scriptPubKeyHasRecords(descriptors[expression]?.scriptPubKeyInfoRecords)
    )
    .sort();
};

/* returns the descriptors expressions that have at least one scriptPubKey that
 * has been used
 * It always returns the same Array object per each networkId if the result
 * never changes*/
export const deriveExpressions = (
  discoveryInfo: DiscoveryInfo,
  networkId: NetworkId
) => {
  // Create a (memoized) factory function
  const memoizedFunc = memoizee(
    (networkId: NetworkId) => {
      const expressionMapper = (discoveryInfo: DiscoveryInfo) =>
        getExpressions(discoveryInfo, networkId);
      return memoizeOneWithShallowArraysCheck(expressionMapper);
    },
    { primitive: true }
  );
  return memoizedFunc(networkId)(discoveryInfo);
};

const getWallets = (expressions: Array<Expression>, networkId: NetworkId) => {
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
export const deriveWallets = (
  expressions: Array<Expression>,
  networkId: NetworkId
): Array<Array<Expression>> => {
  // Create a (memoized) factory function
  const memoizedFunc = memoizee(
    (networkId: NetworkId) => {
      const walletMapper = (expressions: Array<Expression>) =>
        getWallets(expressions, networkId);

      return memoizeOneWithDeepCheck(walletMapper);
    },
    { primitive: true }
  );
  return memoizedFunc(networkId)(expressions);
};
