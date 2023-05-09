# Bitcoin Descriptor Funds Retrieval Library (WIP)

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

- Retrieve Bitcoin funds using ranged descriptors
- Unified access to various Bitcoin blockchain explorer services
- TypeScript support for easy integration and type safety

## Planned Progress

- [ ] Core functionality development
- [ ] Integration with @bitcoinerlab/explorer
- [ ] Unit tests and continuous integration
- [ ] Comprehensive documentation and usage examples

Stay tuned for updates and feel free to contribute to the development of this library. Your feedback is valuable and appreciated.
