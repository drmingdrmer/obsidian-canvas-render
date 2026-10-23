---
aliases: [Galois field, 有限域]
---
A **finite field**, or **Galois field**, is a [[Field]] with finitely many elements. The integers modulo a prime $p$ form the finite field $\mathbb{F}_p$.

## Classification

The order of a finite field is a prime power $q = p^n$, where $p$ is its [[Characteristic]]. For every prime power $q$ there is a field $\mathbb{F}_q$ of order $q$, and all fields of order $q$ are isomorphic: $\mathbb{F}_q$ is the [[Splitting field]] over $\mathbb{F}_p$ of

$$X^q - X = \prod_{a \in \mathbb{F}_q} (X - a).$$

The [[形式导数|derivative]] of $X^q - X$ is $-1$, so its $q$ roots are distinct. $\mathbb{F}_{p^n}$ contains $\mathbb{F}_{p^m}$ if and only if $m$ divides $n$.

## The field with four elements

$\mathbb{F}_4 = \mathbb{F}_2[X]/(X^2 + X + 1)$. With $\alpha$ the image of $X$, $\alpha^2 = 1 + \alpha$, and:

| $+$ | $0$ | $1$ | $\alpha$ | $1+\alpha$ |
|---|---|---|---|---|
| $0$ | $0$ | $1$ | $\alpha$ | $1+\alpha$ |
| $1$ | $1$ | $0$ | $1+\alpha$ | $\alpha$ |
| $\alpha$ | $\alpha$ | $1+\alpha$ | $0$ | $1$ |
| $1+\alpha$ | $1+\alpha$ | $\alpha$ | $1$ | $0$ |

| $\cdot$ | $0$ | $1$ | $\alpha$ | $1+\alpha$ |
|---|---|---|---|---|
| $0$ | $0$ | $0$ | $0$ | $0$ |
| $1$ | $0$ | $1$ | $\alpha$ | $1+\alpha$ |
| $\alpha$ | $0$ | $\alpha$ | $1+\alpha$ | $1$ |
| $1+\alpha$ | $0$ | $1+\alpha$ | $1$ | $\alpha$ |

## Galois theory

The [[Frobenius endomorphism]] $\varphi(x) = x^p$ is an automorphism of $\mathbb{F}_{p^n}$ that fixes $\mathbb{F}_p$, and $\mathrm{Id}, \varphi, \ldots, \varphi^{n-1}$ are all such automorphisms. So $\mathbb{F}_{p^n}/\mathbb{F}_p$ is a [[Galois extension]] with a cyclic [[Galois group]] of order $n$. Since $\varphi$ is onto, every finite field is a [[Perfect field]].

---

*Source: [Finite field](https://en.wikipedia.org/wiki/Finite_field) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
