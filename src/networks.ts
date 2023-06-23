import { Network, networks } from 'bitcoinjs-lib';
import { NetworkId } from './types';

export const getNetworkId = (network: Network): NetworkId => {
  if (network.bech32 === 'bc') return NetworkId.BITCOIN;
  if (network.bech32 === 'bcrt') return NetworkId.REGTEST;
  if (network.bech32 === 'tb') return NetworkId.TESTNET;
  if (network.bech32 === 'sb') return NetworkId.SIGNET;
  throw new Error('Unknown network');
};

export const getNetwork = (networkId: NetworkId): Network => {
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
