# Chapter 1. Introduction to WebAssembly and Emscripten

Welcome to the exciting new world of WebAssembly!
These are early days for WebAssembly, but the technology is currently taking off like a rocket, and by reading this book, you are in a position to get in on the ground floor. If you are interested in game development on the web, or you are interested in learning as much about this new technology as you can to position yourself for when it does reach maturity, you are in the right place. Even though WebAssembly is in its infancy, all major browser vendors have adopted it. These are early days and use cases are limited, but lucky for us, game development is one of them. So, if you want to be early to the party for the next generation of application development on the web, read on, adventurer!

In this chapter, I will introduce you to WebAssembly, Emscripten, and some of the underlying technologies around WebAssembly. I will teach you the basics of the Emscripten toolchain, and how you can use Emscripten to compile C++ code into WebAssembly. We will discuss what LLVM is and how it fits into the Emscripten toolchain. We will talk about WebAssembly's Minimum Viable Product (MVP), the best use cases for WebAssembly in its current MVP form, and what will soon be coming to WebAssembly. I will introduce WebAssembly text (.wat), how we can use it to understand the design of WebAssembly bytecode, and how it differs from other machine bytecodes. We will also briefly discuss asm.js, and its historical significance in the design of WebAssembly. Finally, I will show you how to install and run Emscripten on Windows and Linux.

In this chapter, we will cover the following topics:
What is WebAssembly?
Why do we need WebAssembly?
Why is WebAssembly faster than JavaScript?
Will WebAssembly replace JavaScript?
What is asm.js?
A brief introduction to LLVM
A brief introduction to WebAssembly text
What is Emscripten and how do we use it?

# What is WebAssembly?
WebAssembly is not a high-level programming language like JavaScript, but a compiled binary format thatall major browsersare currently able to execute. WebAssembly is a kind of machine bytecode that was not designed to run directly on any real machine hardware, but runs in the JavaScript engine built into every browser. In some ways, it is similar to the old Java Virtual Machine (JVM); for example, it is a platform-independent compiled bytecode. One major problem with JavaScript bytecode is its requirement for a plugin to be downloaded and installed in the browser for the bytecode to run. Not only is WebAssembly designed to be run directly in a browser without a plugin, but it is also intended to produce a compact binary format that executes efficiently inside a web browser. The MVP version of the specification leverages existing work by the browser makers designing their JavaScript just-in-time (JIT) compiler. WebAssembly is currently a young technology and many improvements are planned. However, developers using the current version of WebAssembly have already seen performance improvements over JavaScript of 10–800%. 
Note
An MVP is the smallest set of features that can be given to a product to allow it to appeal to early adopters. Because the current version is an MVP, the feature set is small. For more information, see this excellent article discussing the "post-MVP future" of WebAssembly: https://hacks.mozilla.org/2018/10/webassemblys-post-mvp-future/.

Why do we need WebAssembly?
JavaScript has been around for a long time. It has evolved from a little scripting language that allowed bells and whistles to be added to a web page, to a sprawling JIT compiled language with a massive ecosystem that can be used to write fully fledged applications. Today, JavaScript is doing a lot of things that were probably never imagined when it was created by Netscape in 1995. JavaScript is an interpreted language, meaning that it must be parsed, compiled, and optimized on the fly. JavaScript is also a dynamically typed language, which creates headaches for an optimizer.

Note
Franziska Hinkelmann, a member of the Chrome V8 team, gave a great talk at the Web Rebels 2017 conference where she discusses all the performance improvements made to JavaScript over the past 20 years, as well as the difficulties they had in squeezing every bit of performance imaginable out of the JavaScript V8 engine: https://youtu.be/ihANrJ1Po0w.

WebAssembly solves a lot of the problems created by JavaScript and its long history in the browser. Because the JavaScript engine is already in bytecode format, it does not need to run a parser, which removes a significant bottleneck in the execution of our application. This design also allows the JavaScript engine to know what data types it is dealing with at all times. The bytecode makes optimization a lot easier. The format allows multiple threads in the browsers to work on compiling and optimizing different parts of the code at the same time.

Note
For a detailed explanation of what is happening when the Chrome V8 engine is parsing code, please refer to this video from the JSConf EU 2017, in which Marja Hölttä (who works on the Chrome V8 tool) goes into more detail than you ever imagined you wanted to learn about parsing JavaScript: https://www.youtube.com/watch?v=Fg7niTmNNLg&t=123s.

WebAssembly is not a high-level programming language, but a binary file with opcodes for a virtual machine. Currently, it is considered to be in an MVP stage of development. The technology is still in its infancy, but even now it offers notable performance and file size benefits for many use cases, such as game development. Because of the current limitations of WebAssembly, we have only two choices for languages to use for its development—C/C++ or Rust. The long-term plan for WebAssembly is to support a wide selection of programming languages for its development. If I wanted to write at the lowest level of abstraction, I could write everything in Web Assembly Text (WAT), but WAT was developed as a language to support debugging and testing and was not intended to be used by developers for writing applications.

Why is WebAssembly faster than JavaScript?
As I have mentioned, WebAssembly is 10–800% faster than JavaScript, depending on the application. To understand why, I need to talk a little about what a JavaScript engine does when it runs JavaScript code versus what it has to do when it runs WebAssembly. I am going to talk specifically about V8 (the Chrome JavaScript engine), although, to my knowledge, the same general process exists within SpiderMonkey (Firefox) and the Chakra (IE & Edge) JavaScript engines.

The first thing the JavaScript engine does is parse your source code into an Abstract Syntax Tree (AST). The source is broken into branches and leaves based on the logic within your application. At this point, an interpreter starts processing the language that you are currently executing. For many years, JavaScript was just an interpreted language, so, if you ran the same code in your JavaScript 100 times, the JavaScript engine had to take that code and convert it to machine code 100 times. As you can imagine, this is wildly inefficient.

The Chrome browser introduced the firstJavaScriptJIT compilerin 2008. A JIT compiler contrasts with an Ahead-of-Time (AOT) compiler in that it compiles your code as it is running that code. A profiler sits and watches the JavaScript execution looking for code thatrepeatedlyexecutes. Whenever it sees code executed a few times, it marks that code as "warm" for JIT compilation. The compiler then compiles a bytecode representation of that JavaScript"stub"code. This bytecode is typically an Intermediate Representation (IR), one step removed from the machine-specific assembly language. Decoding the stub will be significantly faster than running the same lines of code through our interpreter the next time.

Here are the steps needed to run JavaScript code:


Figure 1.1: Steps required by a modern JavaScript engine

While all of this is going on, there is an optimizing compiler that is watching the profiler for "hot" code branches. The optimizing compiler then takes these code branches and optimizes the bytecode that was created by the JIT into highly optimized machine code. At this point, the JavaScript engine has created some super fast running code, but there is a catch (or maybe a few).

The JavaScript engine must make some assumptions about the data types to have an optimized machine code. The problem is, JavaScript is a dynamically typed language. Dynamic typing makes it easier for a programmer to learn how to program JavaScript, but it is a terrible choice for code optimizers. The example I often see is what happens when JavaScript sees the expression c = a + b (although we could use this example for almost any expression).

Just about any machine code that performs this operation does it in three steps:

Load the a value into a register.

Add the b value into a register.
Then store the register into c.

The following pseudo code was taken from section 12.8.3 of the ECMAScript® 2018 Language Specification and describes the code that must run whenever the addition operator (+) is used within JavaScript:

Copy
1. Let lref be the result of evaluating AdditiveExpression.
2. Let lval be ? GetValue(lref).
3. Let rref be the result of evaluating MultiplicativeExpression.
4. Let rval be ? GetValue(rref).
5. Let lprim be ? ToPrimitive(lval).
6. Let rprim be ? ToPrimitive(rval).
7. If Type(lprim) is String or Type(rprim) is String, then
   a. Let lstr be ? ToString(lprim).
   b. Let rstr be ? ToString(rprim).
   c. Return the string-concatenation of lstr and rstr.
8. Let lnum be ? ToNumber(lprim).
9. Let rnum be ? ToNumber(rprim).
10.Return the result of applying the addition operation to lnum and      
   rnum.
Note
You can find theECMAScript® 2018 Language Specification on the web at https://www.ecma-international.org/ecma-262/9.0/index.html.

This pseudo code is not the entirety of what we must evaluate. Several of these steps are calling high-level functions, not running machine code commands. GetValue for example, has 11 steps of its own that are, in turn, calling other steps. All of this could end up resulting in hundreds of machine opcodes. The vast majority of what is happening here is type checking. In JavaScript, when you execute a + b, each one of those variables could be any one of the following types:

Integer
Float
String
Object
Any combination of these

To make matters worse, objects in JavaScript are also highly dynamic. For example, maybe you have defined a function called Point and created two objects with that function using the new operator:

```
function Point( x, y ) {
    this.x = x;
    this.y = y;
}
```
var p1 = new Point(1, 100);
var p2 = new Point( 10, 20 );
Now we have two points that share the same class. Say we added this line:

```
p2.z = 50;
```
This would mean that these two points would then no longer share the same class. Effectively, p2 has become a brand new class, and this has consequences for where that object exists in memory and available optimizations. JavaScript was designed to be a highly flexible language, but this fact creates a lot of corner cases, and corner cases make optimization difficult.

Another problem with optimization created by the dynamic nature of JavaScript is that no optimization is definitive. All optimizations around typing have to use resources continually checking to see whether their typing assumptions are still valid. Also, the optimizer has to keep the non-optimized code just in case those assumptions turn out to be false. The optimizer may determine that assumptions made initially turn out not to have been correct assumptions. That results in a "bailout" where the optimizer will throw away its optimized code and deoptimize, causing performance inconsistencies.

Finally, JavaScript is a language with Garbage Collection (GC), which allows the authors of the JavaScript code to take on less of the burden of memory management while writing their code. Although this is a convenience for the developer, it just pushes the work of memory management on to the machine at run time. GC has become much more efficient in JavaScript over the years, but it is still work that the JavaScript engine must do when running JavaScript that it does not need to do when running WebAssembly.

Executing a WebAssembly module removes many of the steps required to run JavaScript code. WebAssembly eliminates parsing because the AOT compiler completes that function. An interpreter is unnecessary. Our JIT compiler is doing a near one-to-one translation from bytecode to machine code, which is extremely fast. JavaScript requires the majority of its optimizations because of dynamic typing that does not exist in WebAssembly. Hardware agnostic optimizations can be done in the AOT compiler before the WebAssembly compiles. The JIT optimizer need only perform hardware-specific optimizations that the WebAssembly AOT compiler cannot.

Here are the steps performed by the JavaScript engine to run a WebAssembly binary:


Figure 1.2: The steps required to execute WebAssembly

The last thing that I would like to mention is not a feature of the current MVP, but a potential future enabled by WebAssembly. All the code that makes modern JavaScript fast takes up memory. Keeping old copies of the nonoptimized code for bailout takes up memory. Parsers, interpreters, and garbage collectors all take up memory. On my desktop, Chrome frequently takes up about 1 GB of memory. By running a few tests on my website using https://www.classicsolitaire.com, I can see that with the JavaScript engine turned on, the Chrome browser takes up about 654 MB of memory.

Here is a Task Manager screenshot:


Figure 1.3: Chrome Task Manager process screenshot with JavaScript

With JavaScript turned off, the Chrome browser takes up about 295MB.

Here is a Task Manager screenshot:


Figure 1.4: Chrome Task Manager process screenshot without JavaScript

Because this is one of my websites, I know there are only a few hundred kilobytes of JavaScript code on that website. It's a little shocking to me that running that tiny amount of JavaScript code can increase my browser footprint by about 350 MB. Currently, WebAssembly runs on top of the existing JavaScript engines and still requires quite a bit of JavaScript glue code to make everything work, but in the long run, WebAssembly will not only allow us to speed up execution on the web but will also let us do it with a much smaller memory footprint.

Will WebAssembly replace JavaScript?
The short answer to this question is not anytime soon. At present, WebAssembly is still in its MVP stage. At this stage, the number of use cases is limited to applications where WebAssembly has limited back and forth with the JavaScript and the Document Object Model (DOM). WebAssembly is not currently able to directly interact with the DOM, and Emscripten uses JavaScript "glue code" to make that interaction work. That interaction will probably change soon, possibly by the time you are reading this, but in the next few years, WebAssembly will need additional features to increase the number of possible use cases.

WebAssembly is not a "feature complete" platform. Currently, it cannot be used with any languages that require GC. That will change and, eventually, almost all strongly typed languages will target WebAssembly. In addition, WebAssembly will soon become tightly integrated with JavaScript, allowing frameworks such as React, Vue, and Angular to begin replacing significant amounts of their JavaScript code with WebAssembly without impacting the application programming interface (API). The React team is currently working on this to improve the performance of React.

In the long run, it is possible that JavaScript may compile into WebAssembly. For technical reasons, this is a very long way off. Not only does JavaScript require a GC (not currently supported), but because of its dynamic nature, JavaScript also requires a runtime profiler to optimize. Therefore, JavaScript would produce very poorly optimized code, or significant modifications would be needed to support strict typing. It is more likely that a language, such as TypeScript, will add features that allow it to compile into WebAssembly.

Note
The AssemblyScript project in development on GitHub is working on a TypeScript-to-WebAssembly compiler. This project creates JavaScript and uses Binaryen to compile that JavaScript into WebAssembly. How AssemblyScript handles the problem of garbage collection is unclear. For more information, refer to https://github.com/AssemblyScript/assemblyscript.

JavaScript is currently ubiquitous on the web; there are a tremendous number of libraries and frameworks developed in JavaScript. Even if there were an army of developers eager to rewrite the entire web in C++ or Rust, WebAssembly is not yet ready to replace these JavaScript libraries and frameworks. The browser makers have put immense efforts into making JavaScript run (relatively) fast, so JavaScript will probably remain as the standard scripting language for the web. The web will always need a scripting language, and countless developers have already put in the work to make JavaScript that scripting language, so it seems unlikely that JavaScript will ever go away.

There is, however, a need for a compiled format for the web that WebAssembly is likely to fulfill. Compiled code may be a niche on the web at the moment, but it is a standard just about everywhere else. As WebAssembly approaches feature-complete status, it will offer more choices and better performance than JavaScript, and businesses, frameworks, and libraries will gradually migrate toward it.

What is asm.js?
One early attempt to achieve native-like speed in the web browser using JavaScript was asm.js. Although that goal was reached and asm.js was adopted by all the major browser vendors, it never achieved widespread adoption by developers. The beauty of asm.js is that it still runs in most browsers, even in those that do not optimize for it. The idea behind asm.js was that typed arrays could be used in JavaScript to fake a C++ memory heap. The browser simulates pointers and memory allocation in C++, as well as types. A well-designed JavaScript engine can avoid dynamic type checking. Using asm.js, browser makers could get around many of the optimization problems created by the dynamic nature of JavaScript, by just pretending that this version of JavaScript is not dynamically typed. Emscripten, designed as a C++-to-JavaScript compiler, quickly adopted asm.js as the subset of JavaScript that it would compile to because of its improved performance in most browsers. The performance improvements driven by asm.js lead the way to WebAssembly. The same engine modifications used to make asm.js perform well could be used to bootstrap the WebAssembly MVP. Only the addition of a bytecode-to-bytecode compiler was required to take the WebAssembly bytecode and directly convert it into the IR bytecode used by the browser.

Note
At the time of writing, Emscripten does not compile directly from LLVM to WebAssembly. Instead, it compiles to asm.js and uses a tool called Binaryen to convert the asm.js output from Emscripten into WebAssembly.


# A brief introduction to WebAssembly text
WebAssembly binary is not a language, but a build target similar to building for ARM or x86. The bytecode, however, is structured differently than other hardware-specific build targets. The designers of the WebAssembly bytecode had the web in mind. The aim was to create a bytecode that was compact and streamable. Another goal was that the user should be able to do a "view/source" on the WebAssembly binary to see what is going on. WebAssembly text is a companion code to the WebAssembly binary that allows the user to view the bytecode instructions in a human-readable form, similar to the way an assembly language would let you see what opcodes execute in a machine-readable form.

WebAssembly text may initially look unfamiliar to someone used to writing assembly for hardware such as ARM, x86, or 6502 (if you're old school). You write WebAssembly text in `S-expressions`, which has a parentheses-heavy tree structure. Some of the operations are also strikingly high level for an assembly language, such as `if/else` and `loop opcodes`. That makes a lot more sense if you remember that WebAssembly was not designed to run directly on computer hardware, but to download and translate into machine code quickly.

Another thing that will seem a little alien at first when you are dealing with WebAssembly text is the lack of registers. WebAssembly is designed to be a virtual stack machine, which is an alternative to a `register machine`, such as x86 and ARM, with which you might be familiar. A `stack machine` has the advantage of producing significantly smaller bytecode than a register machine, which is one good reason to choose a stack machine for WebAssembly. Instead of using a series of registers to store and manipulate numbers, every opcode in a stack machine pushes values on or off a stack (and sometimes does both). For example, a call to i32.add in WebAssembly pulls two 32-bit integers off the stack, adds them together, then pushes their value back on to the stack. The computer hardware can make the best use of whichever registers are available to perform this operation.
