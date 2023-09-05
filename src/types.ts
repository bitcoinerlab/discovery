// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license
// Example of a discoveryInfo object:
// const discoveryInfo = {
//   ['TESTNET']: /*NetworkInfo*/ {
//     descriptors: {
//       "pkh([73c5da0a/44'/0'/0']xpub6B.../0/*)": /*DescriptorInfo*/ {
//         fetching: true,
//         timeFetched: UNIXTIME_IN_SECONDS,
//         scriptPubKeyInfoRecords: {
//           //this is the index in ranged-descriptors. Use "non-ranged" if non-ranged
//           12: /*ScriptPubKeyInfo*/ {
//             txIds: /*Array<TxId>*/['8923a3830d9c2eac01043ec30e75b0b2b7264697660f8f...'],
//             timeFetched: UNIXTIME_IN_SECONDS
//           }
//         }
//       }
//     },
//     txInfoRecords: {
//       ['8923a3830d9c2eac01043ec30e75b0b2b7264697660f8f615c0483']: /*TxInfo*/ {
//         blockHeight: 0,
//         irreversible: false,
//         txHex?: '0100000000010115b7e9d1f6b8164a0e95544a94f5b0fbfaadc35f84...'
//       }
//     }
//   }
// };

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
  ALL = 'ALL',
  IRREVERSIBLE = 'IRREVERSIBLE',
  CONFIRMED = 'CONFIRMED'
}

/**
 * Type definition for Transaction ID.
 */
export type TxId = string;

/**
 * Type definition for Transaction Information.
 */
export type TxInfo = {
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
 * Type definition for Script Public Key Information.
 */
export type ScriptPubKeyInfo = {
  /**
   * Array of transaction IDs.
   */
  txIds: Array<TxId>;

  /**
   * UNIX timestamp of the last time Explorer.fetchTxHistory was called for
   * this scriptPubKey; 0 if never fetched.
   */
  timeFetched: number;
};

/**
 * Represents a descriptor expression.
 */
export type Expression = string;

/**
 * Represents an account.
 */
export type Account = Expression;

/**
 * Represents the descriptor index for a ranged descriptor (number) or marks
 * this descriptor as non-ranged (string 'non-ranged').
 */
export type DescriptorIndex = number | 'non-ranged';

/**
 * Type definition for Descriptor Information. A descriptor can be ranged or 'non-ranged'.
 * @property {boolean} fetching - Indicates if the descriptor data is being fetched.
 * @property {number} timeFetched - UNIX timestamp of the last fetch, 0 if never fetched.
 * @property {Record<DescriptorIndex, ScriptPubKeyInfo>} scriptPubKeyInfoRecords - Records of ScriptPubKeyInfo.
 */
export type DescriptorInfo = {
  fetching: boolean; // A flag indicating if the descriptor data is being fetched.
  timeFetched: number; //0 if never fetched
  scriptPubKeyInfoRecords: Record<DescriptorIndex, ScriptPubKeyInfo>;
};

/**
 * Type definition for Transaction Hex.
 */
export type TxHex = string;

/**
 * Type definition for Network Information.
 */
export type NetworkInfo = {
  /**
   *Records of DescriptorInfo.
   */
  descriptors: Record<Expression, DescriptorInfo>;
  /**
   *Records of TxInfo.
   */
  txInfoRecords: Record<TxId, TxInfo>;
};

/**
 * Type definition for Discovery Information.
 */
export type DiscoveryInfo = Record<NetworkId, NetworkInfo>;

/**
 * Type definition for Unspent Transaction Output. Format: `${txId}:${vout}`.
 */
export type Utxo = string; //`${txId}:${vout}`
