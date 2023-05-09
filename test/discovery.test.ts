import { RegtestUtils } from 'regtest-client';
import { networks } from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';
import {
  EsploraExplorer,
  ESPLORA_LOCAL_REGTEST_URL
} from '@bitcoinerlab/explorer';
const explorer = new EsploraExplorer({ url: ESPLORA_LOCAL_REGTEST_URL });
const { Descriptor } = descriptors.DescriptorsFactory(secp256k1);
const regtestUtils = new RegtestUtils();
import { DiscoveryFactory } from '../dist';
const { Discovery } = DiscoveryFactory(explorer);

import { fixtures } from './fixtures/discovery';
const network = networks.regtest;

describe('Discovery', () => {
  test(`Fund`, async () => {
    //Let's fund (if needed fund=true) && test (fund=false) the descriptors:
    for (const funding of [true, false]) {
      for (const descriptor of fixtures.regtest.descriptors) {
        if (descriptor.expression.indexOf('*') !== -1) {
          for (const key in descriptor.funds) {
            const index = parseInt(key, 10);
            const address = new Descriptor({
              expression: descriptor.expression,
              network,
              index
            }).getAddress();
            const value = descriptor.funds[index]!;
            const { balance } = await explorer.fetchAddress(address);
            if (funding) {
              //Only fund it if this file has not been run already
              if (balance === 0) await regtestUtils.faucet(address, value);
            } else {
              expect(balance).toEqual(value);
            }
          }
        } else if (typeof descriptor.value !== 'undefined') {
          //This is a non-ranged descriptor
          const address = new Descriptor({
            expression: descriptor.expression,
            network
          }).getAddress();
          const value = descriptor.value;
          const { balance } = await explorer.fetchAddress(address);
          if (funding) {
            //Only fund it if this file has not been run already
            if (balance === 0) await regtestUtils.faucet(address, value);
          } else {
            expect(balance).toEqual(value);
          }
        }
      }
      //Confirm the transactions above
      if (funding) {
        await regtestUtils.mine(6);
        await new Promise(resolve => setTimeout(resolve, 5000)); //sleep 5 sec
      }
    }
  }, 10000);

  test(`Discover`, async () => {
    const discovery = new Discovery();
    for (const descriptor of fixtures.regtest.descriptors) {
      await discovery.discover({
        //gapLimit: 1, //TODO: TEST THIS. with gapLimit 1 it should not get anything
        expression: descriptor.expression,
        network
      });
    }
    console.log(JSON.stringify(discovery.getData(), null, 2));
  });
});
