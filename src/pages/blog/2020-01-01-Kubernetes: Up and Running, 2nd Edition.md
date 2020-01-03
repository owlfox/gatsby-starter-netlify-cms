---
templateKey: blog-post
title: notes of Kubernetes Up and Running, 2nd Edition
date: 2020-01-01T00:00:00.000Z
description: study note
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - book notes
---
Notes of book reading... 

# summary
ch1 why kubernetes
ch2 docker
ch3 how to deploy k8s
ch4 cmds to play with k8s
ch5 pods
ch6  labeling annotation
ch7 services
ch8 ingress/ load balancing
ch9 replicaSet
ch10 life cycle of deployment
ch11 daemon sets
ch12 jobs
ch13 config maps, secrets
ch14  ?
ch15 storage
ch16 extending k8s
ch17 deploy a REAL app
ch18 version control of k8s

# ch1
# why
* availability
* distributed systems
* horizontal scaling
* velocity to ship
  * immutable, once deployed, cannot be modified? - deployed via image
  * 陳述性的設定檔 declarative configuration - defines the container state
  states are version controlled, easy to rollback, restart - infrastructure as code
  V.S. imperative => 沒辦法rollback
  * 自癒能力, operator feature?
* decoupled api and load balancer, message queue
  * crisp API for micro service message passing
* scaling
  * easier to scale up, or auto scaling
  * easier to manage multi function/business architecture
  no need to estimate hardware usage by each team
  better for “two-pizza team,” or roughly six to eight people. to survive with enough resources
  * good for microservice architecture

  ## nouns
  * pod, group of containers, deployable unit.
  * k8s services, naming, discovering, load balancing
  * namespace, access control / firewall of microservices
  * Ingress, combine microservices into surface API?
  * container orchestration API + service-level agreement (SLA) make concerns separated.
  SRE focus on K8s API, SLA, Sysadmin focuses on OS + delivering SLA

好處：不需要太多 AWS, GCP, Asure 的 VM API，可以用同一套方式管理。
Kubernetes PersistentVolumes and PersistentVolumeClaims 在儲存媒介上做了抽象，但是需要用 Postgresql, Cassandra, MySQL, or MongoDB. 等
better use of computing resource, less idle stuff
開發成本降低（不用整天幫開VM）


# ch2
首先我們要知道怎麼做 image
runtime + library + code => app
* 通常 shared library 在 OS 都有，毛病出在 dev, prod 版本不一。
  * 同台機器上的 app 必須用同個版本的 lib
docker 有 registry 可以管理 image，公私有雲都有支援。
目前有 OCI(open container initiative), docker 兩種 container iamge format，k8s 都支援
* container image?
包了你執行程式碼需要所有檔案的二進制檔，你可以用他為基底啟動一個 container。
image 版本控制可以用類似 git 的概念想... 每個 image 版本、內容是基於跟母 image 的差別來存。
directed acyclic graph

雖然 OCI 在 2017 出了 1.0，採用的人還是很少。大部分都還使用 docker image format, 基於 overlay 概念的檔案系統 ，container runtime 可能會用其他的 fs 如 overlay2, aufs, overlay [see this](https://docs.docker.com/storage/storagedriver/select-storage-driver/) ...

* container 通常會跟 configuration file, root fs 綁在一起
* system container(OS 還有必要 service) 退流行了，目前比較風行 application container + pod?

接下來我們來做一個 app container, express 為例子:
[Dockerfile](https://docs.docker.com/engine/reference/builder/) 紀錄建置 docker image 需要的資訊:
安裝 node 套件
```
npm init
npm install --save express
```
package.json
```
{
  "name": "hello_express",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "author": "",
  "license": "ISC",
  "dependencies": {
    "express": "^4.17.1"
  }
}

```
index.js
···
var express = require('express');

var app = express();
app.get('/', function (req, res) {
  res.send('Hello World!');
});
app.listen(3000, function () {
  console.log('Listening on port 3000!');
  console.log('  http://localhost:3000');
});
···

然後dockerfile說明一下你需要怎麼把環境裝起來
```
# 基於 node 10 的 imagge 來建
FROM node:10

# 設定工作目錄，指令會在這裡下
WORKDIR /usr/src/app

# 複製 npm 相關檔案
COPY package*.json ./

RUN npm install

# 複製其他如 原始碼的檔案
COPY . .

# 設定預設的 container 執行指令
CMD [ "npm", "start" ]

```
加上 .dockerignore 檔排除 node_modules 資料夾。
接下來 `docker build -t simple-node .`, ` docker run --rm -p 3000:3000 simple-node` 即可執行該 express app，而且環境可以直接分享給其他人

注意我們在建 image 時 A->B->C 這樣的階層概念時不能倒轉的 A->C->B 。雖然結果一樣，但是因為 overlay 的概念 各層存的資料會不一樣，作者也建議前面的layer以不常變動的為主。

* 儘量不要把大檔案放到 image 裡，這道理跟 git 一樣
* 同理永遠不能把 密碼/key 放到 image 裡面

接下來作者介紹了一個叫 [kuard](https://github.com/kubernetes-up-and-running/kuard) 的 go+react 需要編譯的進階範例
```
# STAGE 1: Build
FROM golang:1.11-alpine AS build

# Install Node and NPM
RUN apk update && apk upgrade && apk add --no-cache git nodejs bash npm

# Get dependencies for Go part of build
RUN go get -u github.com/jteeuwen/go-bindata/...
RUN go get github.com/tools/godep

WORKDIR /go/src/github.com/kubernetes-up-and-running/kuard

# Copy all sources in
COPY . .

# This is a set of variables that the build script expects
ENV VERBOSE=0

ENV PKG=github.com/kubernetes-up-and-running/kuard
ENV ARCH=amd64
ENV VERSION=test

# Do the build. Script is part of incoming sources.
RUN build/build.sh


# STAGE 2: Deployment
FROM alpine

USER nobody:nobody
COPY --from=build /go/bin/kuard /kuard

CMD [ "/kuard" ]
```
大意是分成兩個 image, 一個負責 build, 一個則是 app

還有說了一下怎麼選共有/私有的 image registry

## runtime
Container Runtime Interface, CRI, built on cgroup, namespaces?
docker: containerd-cri
red-hat: cir-o

## resource limiting
docker 還有支援 cpu/mem/swap 管控功能..

# ch3 來個 cluster

install gcp sdk, enable k8s API in your project(s)
```
gcloud init
gcloud config set compute/zone asia-east1
//for zones available https://cloud.google.com/compute/docs/regions-zones/
```

## resources
* https://github.com/kubernetes-up-and-running/examples
book code examples
* http://slack.kubernetes.io/
slack
* https://github.com/kubernetes/kubernetes
source
* https://kubernetes.io/
install kubectl
## gcp
* https://cloud.google.com/kubernetes-engine/docs/how-to/creating-a-cluster
how to create k8s cluster
# reference
“Kubernetes: Up and Running, 2nd edition, by Brendan Burns, Joe Beda, and Kelsey Hightower (O’Reilly). Copyright 2019 Brendan Burns, Joe Beda, and Kelsey Hightower, 978-1-492-04653-0.”
