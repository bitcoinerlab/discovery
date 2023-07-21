# Bitcoin Descriptor Blockchain Retrieval Library

The @bitcoinerlab/discovery library, written in TypeScript, provides a method for retrieving blockchain information essential in Bitcoin wallet development and other applications that require interaction with the Bitcoin blockchain. This library enables querying of data using the *Bitcoin descriptors* syntax, facilitating retrieval of blockchain data such as balance, UTXOs, and transaction history.

## Features

- **Descriptor-Based Data Retrieval:** Retrieves UTXOs, transaction history, and balances for various sources: ranged descriptors, accounts (comprising internal & external descriptors), and addresses (a descriptor specialized for a specific index).

- **Transaction Status Filter:** Offers the ability to filter results by `TxStatus`: `ALL` (including transactions in the mempool), `IRREVERSIBLE` (for transactions with more than a user-defined number of confirmations), and `CONFIRMED` (assuming one confirmation).

- **Pluggable Explorer Interface:** Implements a plugin interface that separates data storage and data derivation from blockchain information retrieval, referred to as the `Explorer` interface. This design enables easy addition of various network explorers. Esplora and Electrum `Explorer` implementations have [already been implemented](https://github.com/bitcoinerlab/explorer). The slim `Explorer` interface makes it easy to add others, such as a Bitcoin Node implementation (planned for a future release).

- **Immutability Principles:** The library revolves around [Immutability](https://en.wikipedia.org/wiki/Immutable_object), which allows for quick comparisons of objects. For instance, you can retrieve the UTXOs of a certain group of ranged descriptors filtered by a particular `TxStatus`. The library will return the same reference if the result did not change, reducing the need for deep comparisons of complex data arrays. This feature greatly simplifies developing applications using reactive rendering engines such as React.

- **Data Derivation:** The library maintains a compact internal structure of information and provides methods to query and derive useful data from it. For example, Balances and UTXOs are computed on-the-fly from raw data, while advanced memoization techniques ensure efficiency. This compact data model allows the library to focus on retrieving and storing only transaction data, eliminating the need to download and keep balances or UTXOs in sync.

- **Wallet Development Support:** The library understands account syntax, providing the next available addresses for change or external retrieval, simplifying the process of wallet development.

## Important Notice

**This library is under active development and not yet ready for production use.**

**This package currently depends on a local copy of the `@bitcoinerlab/explorer` package, which is under development and not yet published on npm**.

To use this package, please follow these steps:

1. Clone the `@bitcoinerlab/explorer` package repository from GitHub:
```bash
git clone https://github.com/bitcoinerlab/explorer.git
```
2. Place the cloned `explorer` directory in the appropriate folder, so that it has the same parent folder as the `discovery` package (e.g., both `explorer` and `discovery` directories should be under the `bitcoinerlab` folder).
3. Navigate to the `explorer` directory and install its dependencies:
```bash
cd explorer
npm install
```
4. Navigate back to the `discovery` directory and install its dependencies:
```bash
cd ../discovery
npm install
```
Please note that this setup is temporary. Both `@bitcoinerlab/explorer` and `@bitcoinerlab/discovery` packages will be published to npm simultaneously once their development is complete. At that time, you will be able to install both packages directly from npm, without the need for the local copy of `@bitcoinerlab/explorer`.

## Description

A TypeScript library for retrieving Bitcoin funds associated with a range of descriptors. The library leverages [@bitcoinerlab/explorer](https://github.com/bitcoinerlab/explorer) to provide standardized access to multiple Bitcoin blockchain explorers.

## Features (Coming Soon)

- Retrieve Bitcoin funds using descriptors
- Unified access to various Bitcoin blockchain explorer services
- TypeScript support for easy integration and type safety
-

## Planned Progress

- [ ] Core functionality development
- [ ] Integration with @bitcoinerlab/explorer
- [ ] Unit tests and continuous integration
- [ ] Comprehensive documentation and usage examples

Stay tuned for updates and feel free to contribute to the development of this library. Your feedback is valuable and appreciated.
