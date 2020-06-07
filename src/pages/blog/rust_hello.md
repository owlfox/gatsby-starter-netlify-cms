---
templateKey: blog-post
title: Hello world with rust
date: 2020-03-11T00:00:00.000Z
description: How to install and build with cargo
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - rust
---
# Install & hello!
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
1. Note: This will not work with centos/rhel6, since the curl version is too old and ssl1.2 is not patched.
- Download it as a script and execute it if you're dealing with such kind of platform.
- you will need cc(gcc) installed, and of course internet connection.
2. install with default setting, this will add rustc, cargo, rustup into your shell env.
3. `cargo new hello`, `cd hello`, `cargo run hello` then you will get the most important message: hello world.

some useful commands:
```bash
rustup update: update rust
```

# To be continued...

