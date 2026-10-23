---
aliases: [域]
tags: [field-theory]
---
A **field** is a set on which addition, subtraction, multiplication and division are defined, and behave as the corresponding operations on rational numbers do. The best known fields are $\mathbb{Q}$, $\mathbb{R}$ and $\mathbb{C}$.

## Definition

A field is a set $F$ with two operations, addition and multiplication, such that for all $a, b, c \in F$:

- both operations are associative and commutative;
- there are distinct elements $0$ and $1$ with $a + 0 = a$ and $a \cdot 1 = a$;
- every $a$ has an additive inverse $-a$, and every $a \neq 0$ has a multiplicative inverse $a^{-1}$;
- multiplication distributes over addition: $a(b + c) = ab + ac$.

More succinctly, a field is a commutative ring in which $0 \neq 1$ and every nonzero element is invertible.

## Prime field

A field with no proper subfield is a **prime field**. Every field contains one, and its [[Characteristic]] decides which: $\mathbb{Q}$ in characteristic $0$, and $\mathbb{F}_p = \mathbb{Z}/p\mathbb{Z}$ in characteristic $p$.

Every field homomorphism is injective, so a homomorphism $F \to E$ makes $E$ a [[Field extension]] of $F$. The polynomials over $F$ form the [[Polynomial ring]] $F[x]$. The smallest field that is not a prime field is the [[Finite field]] with four elements.

---

*Source: [Field (mathematics)](https://en.wikipedia.org/wiki/Field_(mathematics)) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
