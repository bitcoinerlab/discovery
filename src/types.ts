import type { Transaction } from 'bitcoinjs-lib';
/**
 * Versions the structure of the data model. This variable should to be
 * changed when any of the types below change.
 */
export const DATA_MODEL_VERSION = 'V1';

// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license
//
//
// const discoveryData: DiscoveryData = Record<NetworkId, NetworkData> {
//   ['TESTNET']: /*NetworkData: {descriptorMap, txMap}*/ {
//     descriptorMap: Record<string,  DescriptorData> {
//       "pkh([73c5da0a/44'/0'/0']xpub6B.../0/*)": DescriptorData {
//         fetching: true,
//         timeFetched: UNIXTIME_IN_SECONDS,
//         range: Record<DescriptorIndex, OutputData>{ //DescriptorIndex = number|'non-ranged'
//           //this is the index in ranged-descriptors. Use "non-ranged" if non-ranged
//           12: OutputData {
//             txIds: /*Array<TxId>*/['8923a3830d9c2eac01043ec30e75b0b2b7264697660f8f...'],
//             fetching: true,
//             timeFetched: UNIXTIME_IN_SECONDS
//           }
//         }
//       }
//     },
//     txMap: Record<TxId, TxData> {
//       ['8923a3830d9c2eac01043ec30e75b0b2b7264697660f8f615c0483']: TxData {
//         blockHeight: 0,
//         irreversible: false,
//         txHex?: '0100000000010115b7e9d1f6b8164a0e95544a94f5b0fbfaadc35f84...'
//       }
//     }
//   }
// };

export type OutputCriteria = {
  /**
   * Descriptor expression representing one or potentially multiple outputs if
   * ranged.
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
   * Specifies the filtering criteria based on transaction status:
   * `TxStatus.ALL`, `TxStatus.IRREVERSIBLE`, or `TxStatus.CONFIRMED`.
   * @defaultValue TxStatus.ALL
   */
  txStatus?: TxStatus;
};

/**
 * Enumeration of network identifiers.
 * @enum {string}
 */
export enum NetworkId {
  BITCOIN = 'BITCOIN',
  REGTEST = 'REGTEST',
  TESTNET = 'TESTNET',
  SIGNET = 'SIGNET'
}

/**
 * Enumeration of transaction statuses.
 * @enum {string}
 */
export enum TxStatus {
  /** ALL includes unconfirmed transactions */
  ALL = 'ALL',
  IRREVERSIBLE = 'IRREVERSIBLE',
  /** CONFIRMED with at least 1 confirmation */
  CONFIRMED = 'CONFIRMED'
}
/**
 * A string representing an indexed descriptor for ranged descriptors or a
 * descriptor followed by a separator and the keyword "non-ranged".
 *
 * An `IndexedDescriptor` is a descriptor representation what must correspond to
 * a single output.
 *
 * - If it is ranged, then add an integer after the separaror (a
 * tilde "\~").
 * - It it is non-ranged, add the string "non-ranged" after the tilde "\~".
 *
 * Examples:
 * pkh([73c5da0a/44'/1'/0']tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba/0/*)\~12
 * pkh([73c5da0a/44'/1'/0']tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba)\~non-ranged
 */
export type IndexedDescriptor = string;
/**
 * a Txo is represented in a similar manner as a Utxo, that is,
 * prevtxId:vout. Hovewer, we use a different type name to denote we're dealing
 * here with tx outputs that may have been spent or not
 */
export type Txo = string;
export type TxoMap = Record<Txo, IndexedDescriptor>;

/**
 * Type definition for Transaction ID.
 */
export type TxId = string;

/**
 * Type definition for Unspent Transaction Output. Format: `${txId}:${vout}`.
 */
export type Utxo = string; //`${txId}:${vout}`

/**
 * Type definition for Spent Transaction Output. Format:
 * `${txId}:${vout}:${recipientTxId}:${recipientVin}`,
 * that is, a previous Utxo ${txId}:${vout} was eventually spent in this tx:
 * ${recipientTxId}:${recipientVin}
 */
export type Stxo = string; //`${txId}:${vout}:${recipientTxId}:${recipientVin}`

export type TxWithOrder = {
  blockHeight: number;
  tx?: Transaction;
  txHex?: string;
};

/**
 * Type definition for Transaction Information.
 */
export type TxData = {
  /**
   * The block height.
   */
  blockHeight: number;
  /**
   * Indicates if the transaction is irreversible.
   */
  irreversible: boolean;
  /**
   * The transaction hex, optional.
   */
  txHex?: TxHex;
};

/**
 * Represents the attribution details of a transaction.
 *
 * `TxAttribution` is used to mark the owner of the inputs and outputs for each
 * transaction.
 *
 * This can be used in wallet apps to specify whether inputs are from owned
 * outputs (e.g., change in a previous transaction) or come from third parties.
 * Similarly, it specifies when outputs are either destined to third parties or
 * correspond to internal change. This is useful because wallet apps typically
 * show transaction history with "Sent" or "Received" labels, considering only
 * ins/outs from third parties.
 *
 * - `ownedPrevTxo/ownedTxo` indicates the ownership of the previous output/next
 *   output:
 *   - `false` if the previous/next output cannot be described by one of the
 *     owned descriptors.
 *   - An object containing the descriptor and optional index (for ranged
 *     descriptors).
 * - `value` is the amount received/sent in this input/output. `value` will not
 *   be set in inputs when inputs are not owned.
 *
 * - `netReceived` indicates the net amount received by the controlled
 *   descriptors in this transaction. If > 0, it means funds were received;
 *   otherwise, funds were sent.
 *
 * - `type`:
 *   - `CONSOLIDATED`: ALL inputs and outputs are from/to owned descriptors.
 *   - `RECEIVED_AND_SENT` if:
 *     - SOME outputs are NOT owned and SOME inputs are owned, and
 *     - SOME outputs are owned and SOME inputs are NOT owned.
 *     This is an edge case that typically won't occur in wallets.
 *   - `SENT`:
 *     - if there are SOME outputs NOT owned and SOME inputs are owned.
 *     - not `RECEIVED_AND_SENT`.
 *   - `RECEIVED`:
 *     - if there are SOME outputs owned and SOME inputs are NOT owned.
 *     - not `RECEIVED_AND_SENT`.
 *
 * Tip: You can use `getDescriptor({txo: owned})` to see what descriptor
 * corresponds to `getDescriptor({txo: ins[x].ownedPrevTxo})` or
 * `getDescriptor({txo: outs[y].ownedTxo})`.
 */

export type TxAttribution = {
  txId: TxId;
  blockHeight: number;
  irreversible: boolean;
  ins: Array<{
    //none are set if the prev output cannot be described by one of the owned descriptors
    ownedPrevTxo: Utxo | false; //the prev output where funds come from in this input
    value?: number; //amount received
  }>;
  outs: Array<{
    ownedTxo: Utxo | false; //the owned output where funds are sent in this tx output. Not set if the output is not owned by the descriptors
    value: number; //amount sent. Always set
  }>;
  netReceived: number;
  type: 'CONSOLIDATED' | 'RECEIVED' | 'SENT' | 'RECEIVED_AND_SENT';
};

/**
 * Type definition for Script Public Key Information.
 */
export type OutputData = {
  /**
   * Array of transaction IDs associated with an output.
   */
  txIds: Array<TxId>;

  fetching: boolean; // A flag indicating if this output is being fetched.

  /**
   * UNIX timestamp of the last time Explorer.fetchTxHistory was called for
   * this scriptPubKey; 0 if never fetched.
   */
  timeFetched: number;
};

/**
 * Represents a descriptor expression.
 */
export type Descriptor = string;

/**
 * Represents an account. Accounts are descriptors pairs with keyPaths
 * ending in `{/0/*, /1/*}`. Per convention, in BitcoinerLab an account is
 * identified by its external descriptor `keyPath = /0/*`.
 */
export type Account = Descriptor;

/**
 * Represents the descriptor index for a ranged descriptor (number) or marks
 * this descriptor as non-ranged (string 'non-ranged').
 */
export type DescriptorIndex = number | 'non-ranged';

/**
 * Type definition for Descriptor Information. A descriptor can be ranged or 'non-ranged'.
 * @property {boolean} fetching - Indicates if the descriptor data is being fetched.
 * @property {number} timeFetched - UNIX timestamp of the last fetch, 0 if never fetched.
 * @property {Record<DescriptorIndex, OutputData>} range - Records of OutputData.
 */
export type DescriptorData = {
  fetching: boolean; // A flag indicating if the descriptor data is being fetched.
  timeFetched: number; //0 if never fetched
  range: Record<DescriptorIndex, OutputData>;
};

/**
 * Type definition for Transaction Hex.
 */
export type TxHex = string;

/**
 * Type definition for Network Information.
 */
export type NetworkData = {
  /**
   *Records of DescriptorData.
   */
  descriptorMap: Record<Descriptor, DescriptorData>;
  /**
   *Records of TxData.
   */
  txMap: Record<TxId, TxData>;
};

/**
 * Type definition for Discovery Information.
 */
export type DiscoveryData = Record<NetworkId, NetworkData>;
