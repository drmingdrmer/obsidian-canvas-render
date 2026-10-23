For a commutative ring $R$ of prime [[Characteristic]] $p$, the **Frobenius endomorphism** maps every element to its $p$-th power:

$$F(r) = r^p.$$

It respects multiplication, since $(rs)^p = r^p s^p$. It respects addition too: in the binomial expansion of $(r + s)^p$, every coefficient $\binom{p}{k}$ with $0 < k < p$ is divisible by $p$, so

$$(r + s)^p = r^p + s^p.$$

## Injective, not always onto

On a [[Field]], $F$ is injective. It need not be onto: in $K = \mathbb{F}_p(t)$, the element $t$ is not a $p$-th power, because the degree of the $p$-th power of a rational function is a multiple of $p$. A field whose Frobenius is onto, or whose characteristic is $0$, is a [[Perfect field]], so $\mathbb{F}_p(t)$ is imperfect.

## Generator of Galois groups

On a [[Finite field]] $\mathbb{F}_q$ with $q = p^n$, $F$ fixes $\mathbb{F}_p$ and has order $n$. It generates the [[Galois group]]:

$$\operatorname{Gal}(\mathbb{F}_{p^n}/\mathbb{F}_p) = \{\mathrm{Id}, F, F^2, \ldots, F^{n-1}\} \cong \mathbb{Z}/n\mathbb{Z}.$$

---

*Source: [Frobenius endomorphism](https://en.wikipedia.org/wiki/Frobenius_endomorphism) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
