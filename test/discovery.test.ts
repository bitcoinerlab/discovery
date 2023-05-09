import { Discovery } from '../dist';
describe('Discovery', () => {
  test(`Initial test`, async () => {
    console.log(Discovery);
    expect(1).toEqual(1);

    //Create a ranged descriptor. A wpkh for instance
    //Then fund it in the regtest and get funds from it
  }, 10000);
});
