The **polynomial ring** $K[X]$ over a [[Field]] $K$ is the ring of polynomials in one indeterminate $X$ with coefficients in $K$. It shares many properties with the ring of integers $\mathbb{Z}$, because polynomials, like integers, have a long division.

## Euclidean division

Given $a$ and $b \neq 0$ in $K[X]$, there is a unique pair $(q, r)$ with

$$a = bq + r, \qquad r = 0 \ \text{or}\ \deg r < \deg b.$$

Euclidean division gives the [[Polynomial greatest common divisor|greatest common divisor]] by Euclid's algorithm, Bézout's identity, and unique factorization: every nonconstant polynomial is a constant times a product of [[Irreducible polynomial|irreducible]] monic polynomials, unique up to the order of the factors.

## Derivative

The [[形式导数|formal derivative]] of $a_0 + a_1X + a_2X^2 + \cdots + a_nX^n$ is

$$a_1 + 2a_2X + \cdots + na_nX^{n-1}.$$

It needs no limit, so it exists over every field. The integers have nothing like it.

## Quotient rings

For a polynomial $p$ of degree $d$, the quotient ring $K[X]/(p)$ is the vector space of the polynomials of degree less than $d$, multiplied modulo $p$. It is a field if and only if $p$ is irreducible. For example,

$$\mathbb{C} = \mathbb{R}[X]/(X^2 + 1).$$

---

*Source: [Polynomial ring](https://en.wikipedia.org/wiki/Polynomial_ring) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
