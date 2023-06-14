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
const { Descriptor } = DescriptorsFactory(secp256k1);

// This is an extension to memoizee that checks function checks whether
// discoveryInfo has changed and it applies resultEqualityCheck so that the
// returned array has the same reference (if it is shallow-equal as the
// previous one). Also it only memoizes one record.
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
