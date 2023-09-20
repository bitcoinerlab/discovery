// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license
//import { DiscoveryFactory } from '../dist';
//import { networks, crypto } from 'bitcoinjs-lib';

test('This lib still needs the following unit tests', () => {
  expect(true).toBe(true);
});

//import type { Explorer } from '@bitcoinerlab/explorer';
//
//// Mock dependencies if necessary
//jest.mock('@bitcoinerlab/explorer');
//jest.mock('bitcoinjs-lib');
//
//describe('Discovery', () => {
//  let discovery: InstanceType<ReturnType<typeof DiscoveryFactory>['Discovery']>;
//
//  let Discovery;
//
//  let explorerMock: jest.Mocked<Explorer>;
//
//  beforeEach(() => {
//    explorerMock = {
//      connect: jest.fn(),
//      close: jest.fn(),
//      fetchUtxos: jest.fn(),
//      fetchAddress: jest.fn(),
//      fetchScriptHash: jest.fn(),
//      fetchTxHistory: jest.fn(),
//      fetchTx: jest.fn(),
//      fetchFeeEstimates: jest.fn(),
//      fetchBlockHeight: jest.fn()
//    };
//
//    // Initialize Discovery instance for each test
//    Discovery = DiscoveryFactory(explorerMock).Discovery;
//    discovery = new Discovery();
//  });
//
//  afterEach(() => {
//    jest.resetAllMocks();
//  });
//
//  describe('discoverScriptPubKey', () => {
//    it('should discover script pub key and update discoveryInfo', async () => {
//      const expression = 'scriptPubKeyExpression';
//      const index = 0;
//      const network = networks.bitcoin;
//
//      explorerMock.fetchTxHistory.mockResolvedValueOnce([
//        { txId: 'txId1', blockHeight: 100, irreversible: true },
//        { txId: 'txId2', blockHeight: 200, irreversible: false }
//      ]);
//
//      const result = await discovery.discoverScriptPubKey({
//        expression,
//        index,
//        network
//      });
//
//      expect(result).toBe(true);
//      expect(explorerMock.fetchTxHistory).toHaveBeenCalledWith({
//        scriptHash: crypto.sha256('scriptPubKey').toString('hex')
//      });
//      expect(discovery.getDiscoveryInfo()).toEqual({
//        [networks.bitcoin]: {
//          descriptors: {
//            [expression]: {
//              scriptPubKeyInfoRecords: {
//                [index]: {
//                  txIds: ['txId1', 'txId2'],
//                  timeFetched: expect.any(Number)
//                }
//              }
//            }
//          },
//          txInfoRecords: {
//            txId1: { irreversible: true, blockHeight: 100 },
//            txId2: { irreversible: false, blockHeight: 200 }
//          }
//        }
//      });
//    });
//  });
//
//  describe('getBalanceScriptPubKey', () => {
//    it('should return the balance for a script pub key', () => {
//      // Test case implementation
//    });
//
//    // Add more test cases for different scenarios
//  });
//
//  describe('getBalance', () => {
//    it('should return the balance for an expression or array of expressions', () => {
//      // Test case implementation
//    });
//
//    // Add more test cases for different scenarios
//  });
//
//  // Add more test blocks for other methods
//
//  describe('getDiscoveryInfo', () => {
//    it('should return the discoveryInfo object', () => {
//      const discoveryInfo = discovery.getDiscoveryInfo();
//
//      expect(discoveryInfo).toEqual({
//        [networks.bitcoin]: {
//          descriptors: {},
//          txInfoRecords: {}
//        }
//      });
//    });
//  });
//});
