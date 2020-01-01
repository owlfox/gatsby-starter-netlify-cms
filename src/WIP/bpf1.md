Preface
“extended BPF use cases: …crazy stuff.”

—Alexei Starovoitov, creator of the new BPF, February 2015 [1]

In July 2014, Alexei Starovoitov visited the Netflix offices in Los Gatos, California, to discuss a fascinating new technology that he was developing: extended Berkeley Packet Filter (abbreviated eBPF or just BPF). BPF was an obscure technology for improving packet filter performance, and Alexei had a vision of extending it far beyond packets. Alexei had been working with another network engineer, Daniel Borkmann, to turn BPF into a general-purpose virtual machine, capable of running advanced networking and other programs. It was an incredible idea. A use case that interested me was performance analysis tools, and I saw how this BPF could provide the programmatic capabilities I needed. We made an agreement: If Alexei made it connect to more than just packets, I’d develop the performance tools to use it.

BPF can now attach to any event source, and it has become the hot new technology in systems engineering, with many active contributors. To date, I have developed and published more than 70 BPF performance analysis tools which are in use worldwide and are included by default on servers at Netflix, Facebook, and other companies. For this book, I’ve developed many more, and I’ve also included tools from other contributors. It’s my privilege to share this work here in BPF Performance Tools to give you practical tools that you can use for performance analysis, troubleshooting, and more.

As a performance engineer, I am obsessed with using performance tools in a quest to leave no stone unturned. Blind spots in systems are where performance bottlenecks and software bugs hide. My prior work used the DTrace technology, and included my 2011 Prentice Hall book DTrace: Dynamic Tracing in Oracle Solaris, Mac OS X, and FreeBSD, where I shared the DTrace tools I had developed for those operating systems. It’s exciting to now be able to share similar tools for Linux—tools that can do and see even more.

WHY DO YOU NEED BPF PERFORMANCE TOOLS?
BPF performance tools can help you get the most out of your systems and applications, by helping you improve performance, reduce costs, and solve software issues. They can analyze much further than traditional tools, and allow you to pose arbitrary questions of the system and get answers immediately, in production environments.

ABOUT THIS BOOK
This book is about BPF tools as used primarily for observability and performance analysis, but these tools have other uses as well: software troubleshooting, security analysis, and more. The hardest part about learning BPF is not how to write the code: you can learn any of the interfaces in a day or so. The hard part is knowing what to do with it: What should you trace out of the many thousands of available events? This book helps to answer that question by giving you the necessary background for performance analysis and then analyzing many different software and hardware targets using BPF performance tools, with example output from Netflix production servers.

BPF observability is a superpower, but only because it is extending our visibility into systems and applications—not duplicating it. For you to wield BPF efficiently, you need to understand when to use traditional performance analysis tools, including iostat(1) and perf(1), and when to use BPF tools. The traditional tools, also summarized in this book, may solve performance problems outright, and when they do not, they provide useful context and clues for further analysis with BPF.

Many of this book’s chapters include learning objectives to guide you to the most important take-aways. The material in this book is also used for an internal Netflix training class on BPF analysis, and some chapters include optional exercises.1

1 There are also mode switches: Linux syscalls that do not block may only (depending on the processor) need to switch modes between user- and kernel-mode.

Many of the BPF tools in this book are from the BCC and bpftrace repositories, which are part of the Linux Foundation IO Visor project. These are open source and available for free, not only from the repository websites but also packaged for various Linux distributions. I have also written many new bpftrace tools for this book, and I include their source code here.

These tools were not created to arbitrarily demonstrate various BPF capabilities. They were created to do battle in production environments. These are the tools I’ve needed for solving production issues beyond the abilities of the current analysis toolset.

For the tools written in bpftrace, the source code has been included in the book. If you wish to modify or develop new bpftrace tools, you can learn the bpftrace language from Chapter 5, and you can also learn by example from the many source code listings here. This source code helps explain what each tool is doing and the events they instrument: It is like including pseudocode that you can run.

The BCC and bpftrace front ends are reaching maturity, but it is possible that future changes will cause some of the source code included in this book to stop working and require updates. If a tool originates in BCC or bpftrace, check those repositories for updated versions. If a tool originated in this book, check this book’s website: http://www.brendangregg.com/bpf-performance-tools-book.html. What matters most is not that a tool works, but that you know about the tool and want it to work. The hardest part with BPF tracing is knowing what to do with it; even broken tools are a source of useful ideas.

NEW TOOLS
To provide you with a comprehensive set of analysis tools that double as code examples, more than 80 new tools were developed for this book. Many of them are pictured in Figure P-1. In this diagram, preexisting tools appear in black text, and the new tools created for this book appear in red or gray (depending on the version of the book you’re reading). Both preexisting and new tools are covered in this book, though many later diagrams do not use the red/gray/black color scheme to differentiate them.


Figure P-1 BPF performance tools: Preexisting and new tools written for this book

ABOUT GUIS
Some of the BCC tools have already become sources of metrics for GUIs—providing time series data for line graphs, stack traces for flame graphs, or per-second histograms for heat maps. I expect that more people will use these BPF tools via GUIs than will use the tools directly. Regardless of how you end up using them, they can provide a wealth of information. This book explains their metrics, how to interpret them, and how to create new tools yourself.

ABOUT LINUX VERSIONS
Throughout this book, many Linux technologies are introduced, often with the kernel version number and year they appeared. I’ve sometimes named the developers of the technology as well so that you can recognize supporting materials written by the original authors.

Extended BPF was added to Linux in parts. The first part was added in Linux 3.18 in 2014, and more has been added throughout the Linux 4.x and 5.x series since then. To have sufficient capabilities available to run the BPF tools in this book, Linux 4.9 or higher is recommended. The examples in this book are taken from Linux 4.9 to 5.3 kernels.

Work has begun to bring extended BPF to other kernels, and a future edition of this book may cover more than just Linux.

WHAT THIS BOOK DOES NOT COVER
BPF is a large topic, and there are many use cases outside BPF performance tools that are not covered in this book. These include BPF for software-defined networking, firewalls, container security, and device drivers.

This book focuses on using bpftrace and BCC tools, as well as on developing new bpftrace tools, but it does not cover developing new BCC tools. The BCC source listings are usually too long to include, but some examples have been provided as optional content in Appendix C. There are also examples of tool development using C programming in Appendix D and BPF instructions in Appendix E, which may also be useful for those wishing to gain a deeper understanding of how BPF tools work.

This book does not specialize in the performance of one language or application. Other books do that, and they also cover language debugging and analysis tools. You are likely to use some of these other tools alongside BPF tools to solve problems, and you will find that the different toolsets can be complementary, each providing different clues. Basic systems analysis tools from Linux are included here, so that you can find easy wins without having to reinvent any wheels before moving to BPF tools that can help you see further.

This book includes a brief summary of the background and strategy for each analysis target. These topics are explained in more detail in my earlier Prentice Hall book, Systems Performance: Enterprise and the Cloud [Gregg 13b].

HOW THIS BOOK IS STRUCTURED
There are three parts to this book. The first part, Chapters 1 to 5, covers the background needed for BPF tracing: performance analysis, kernel tracing technologies, and the two core BPF tracing front ends: BCC and bpftrace.

The second part spans Chapters 6 to 16 and covers BPF tracing targets: CPUs, memory, file systems, disk I/O, networking, security, languages, applications, the kernel, containers, and hypervisors. While you could study these chapters in order, the book is designed to support skipping to a chapter of particular interest to you. These chapters all follow a similar format: background discussion, analysis strategy suggestions, and then specific BPF tools. Functional diagrams are included to guide you through complex topics and help you build mental maps of what you are instrumenting.

The last part, spanning Chapters 17 and 18, covers some additional topics: other BPF tools, and tips, tricks, and common problems.

The appendixes provide bpftrace one-liners and a bpftrace cheat sheet, introductions for BCC tool development, C BPF tool development including via perf(1) (the Linux tool), and a BPF instructions summary.

This book uses numerous terms and abbreviations. Where possible, they are explained. See the Glossary for a full reference.

For further sources of information, see the Supplemental Material and References section at the end of this Preface, as well as the Bibliography at the end of the book.

INTENDED AUDIENCE
This book is designed to be useful to a wide range of people. No coding is necessary to use the BPF tools in this book: You can use it as a cookbook of prewritten tools that are ready for you to run. If you do wish to write code, all the included code and Chapter 5 will help you learn to quickly write your own tools.

A background in performance analysis is also not necessary; each chapter summarizes the necessary background details.

Specific audiences for this book include:

Systems administrators, site reliability engineers, database administrators, performance engineers, and support staff responsible for production systems can use this book as a resource for diagnosing performance issues, understanding resource usage, and troubleshooting problems.

Application developers can use these tools to analyze their own code and instrument their code along with system events. For example, disk I/O events can be examined along with the application code that triggered them. This provides a more complete view of behavior, beyond application-specific tools that have no direct visibility into kernel events.

Security engineers can learn how to monitor all events to find suspicious behavior and create whitelists of normal activity (see Chapter 11).

Performance monitoring developers can use this book to get ideas about adding new observability to their products.

Kernel developers can learn how to write bpftrace one-liners for debugging their own code.

Students studying operating systems and applications can use BPF instrumentation to analyze the running system in new and custom ways. Instead of learning about abstract kernel technologies on paper, students can trace them and see how they operate live.

So that this book can focus on the application of BPF tools, it assumes a minimum knowledge level for the topics covered—including basic networking (such as what an IPv4 address is) and command line usage.

SOURCE CODE COPYRIGHT
This book contains the source code to many BPF tools. Each tool has a footnote to explain its origin: whether it comes from BCC, bpftrace, or was written for this book. For any tool from BCC or bpftrace, see its full source in the respective repository for applicable copyright notices.

The following is the copyright notice for the new tools I developed for this book. This notice is included in the full source of these tools released in the book repository, and this notice should not be removed when sharing or porting these tools:

Click here to view code image


/*
 * Copyright 2019 Brendan Gregg.
 * Licensed under the Apache License, Version 2.0 (the "License").
 * This was originally created for the BPF Performance Tools book
 * published by Addison Wesley. ISBN-13: 9780136554820
 * When copying or porting, include this comment.
 */

It is expected that some of these tools will be included in commercial products to provide advanced observability, as has been the case with my earlier tools. If a tool originated from this book, please provide attribution in the production documentation for this book, the BPF technology, and me.

Figure Attributions

Figures 17-02 to 17-09: Vector screenshots, © 2016 Netflix, Inc.

Figure 17-10: grafana-pcp-live screenshot, Copyright 2019 © Grafana Labs

Figures 17-11 to 17-14: Grafana screenshots, Copyright 2019 © Grafana Labs

SUPPLEMENTAL MATERIAL AND REFERENCES
Readers are encouraged to visit the website for this book:

http://www.brendangregg.com/bpf-performance-tools-book.html

All the tools contained in the book, as well as book errata and reader feedback, can be downloaded from this site.

Many of the tools discussed in this book are also in source code repositories where they are maintained and enhanced. Refer to these repositories for the latest versions of these tools:

https://github.com/iovisor/bcc

https://github.com/iovisor/bpftrace

These repositories also contain detailed reference guides and tutorials, which I created and the BPF community maintains and updates.

CONVENTIONS USED IN THIS BOOK
This book discusses different types of technology, and the way it presents material provides more context.

For tool output, bold text indicates the command that was executed or, in some cases, highlights something of interest. A hash prompt (#) signifies that the command or tool has been run as the root user (administrator). For example:

Click here to view code image


# id
uid=0(root) gid=0(root) groups=0(root)

A dollar prompt ($) signifies running the command or tool as a non-root user:

Click here to view code image


$ id
uid=1000(bgregg) gid=1000(bgregg) groups=1000(bgregg),4(adm),27(sudo)

Some prompts include a directory name prefix to show the working directory:

Click here to view code image


bpftrace/tools$ ./biolatency.bt

Italic is used to highlight new terms, and is sometimes used to show placeholder text.

Most of the tools in this book require root access or equivalent privileges to run, shown by the repeated use of hash prompts. If you are not root, one way to execute tools as root is to prefix them with sudo for the sudo(8) command (super-user do).

Some commands are executed in single quotation marks to prevent unnecessary (albeit unlikely) shell expansions. It is a good habit to form. For example:

Click here to view code image


# funccount 'vfs_*'

A Linux command name or system call is followed by the man page chapter enclosed in parentheses—for example, the ls(1) command, the read(2) system call, and the funccount(8) system administration command. Empty parentheses signify function calls from a programming language—for example, the vfs_read() kernel function. When commands with arguments are included in paragraphs, they use a monospace font.

Command output that is truncated includes an ellipsis in square brackets ([...]). A single line containing ^C indicates that Ctrl-C was typed to terminate the program.

Bibliography references for websites are numbered: e.g., [123].