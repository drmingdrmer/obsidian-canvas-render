A polynomial $P$ over a [[Field]] $K$ is **separable** if its roots are distinct in an [[Algebraic closure]] of $K$, that is, if the number of distinct roots equals its degree.

$P$ is separable if and only if it has no [[Repeated root 重根|repeated root]], and if and only if it is coprime to its [[形式导数|formal derivative]]:

$$\gcd(P, P') = 1.$$

The [[Polynomial greatest common divisor|GCD]] is computed in $K[X]$ itself, so separability is decided without leaving $K$.

## Irreducible polynomials

An [[Irreducible polynomial|irreducible]] polynomial $P$ is inseparable if and only if $P' = 0$. Then $K$ has a prime [[Characteristic]] $p$, and

$$P(X) = Q(X^p)$$

for some polynomial $Q$ over $K$. The typical example is $X^p - T$ over the field $\mathbb{F}_p(T)$ of rational functions: it is irreducible, and its one root $T^{1/p}$ is a $p$-fold root. Over a [[Perfect field]], every irreducible polynomial is separable.

## Separable extensions

An algebraic extension $L/K$ is a [[Separable extension]] when the [[Minimal polynomial]] of every element of $L$ is separable.

---

*Source: [Separable polynomial](https://en.wikipedia.org/wiki/Separable_polynomial) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
