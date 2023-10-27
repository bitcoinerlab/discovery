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
//         range: Record<OutputIndex, OutputData>{ //OutputIndex = number|'non-ranged'
//           //this is the index in ranged-descriptors. Use "non-ranged" if non-ranged
//           12: OutputData {
//             txIds: /*Array<TxId>*/['8923a3830d9c2eac01043ec30e75b0b2b7264697660f8f...'],
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

import type { Network } from 'bitcoinjs-lib';
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
   * The network to which the outputs belong.
   */
  network: Network;

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
 * Type definition for Transaction ID.
 */
export type TxId = string;

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
 * Type definition for Script Public Key Information.
 */
export type OutputData = {
  /**
   * Array of transaction IDs associated with an output.
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

/**
 * Type definition for Unspent Transaction Output. Format: `${txId}:${vout}`.
 */
export type Utxo = string; //`${txId}:${vout}`
