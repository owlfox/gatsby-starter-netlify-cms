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

## resources
* https://github.com/kubernetes-up-and-running/examples
book code examples
* http://slack.kubernetes.io/
slack
* https://github.com/kubernetes/kubernetes
source
* https://kubernetes.io/
install kubectl
# reference
“Kubernetes: Up and Running, 2nd edition, by Brendan Burns, Joe Beda, and Kelsey Hightower (O’Reilly). Copyright 2019 Brendan Burns, Joe Beda, and Kelsey Hightower, 978-1-492-04653-0.”