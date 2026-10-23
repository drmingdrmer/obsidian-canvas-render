The **greatest common divisor** of two polynomials is a polynomial of the highest possible degree that divides both. Over a [[Field]], it is defined up to a nonzero constant factor, and is usually taken monic.

## Euclid's algorithm

As for integers, [[Polynomial ring|Euclidean division]] gives Euclid's algorithm: replace the pair $(a, b)$ by $(b, \operatorname{rem}(a, b))$ until $b = 0$.

$$
\gcd(a, b) = \begin{cases}
a & \text{if } b = 0 \\
\gcd(b, \operatorname{rem}(a, b)) & \text{otherwise}
\end{cases}
$$

```python
def poly_gcd(a, b):
    while b != 0:
        a, b = b, a % b
    return a.monic()
```

The degrees of the remainders strictly decrease, so the algorithm stops after at most $\deg b$ steps. Each step keeps the set of common divisors, so the last nonzero remainder is a GCD.

## Multiple roots

The roots of $\gcd(f, g)$ are the common roots of $f$ and $g$, found without computing any root. In particular, the multiple roots of $f$ are the roots of $\gcd(f, f')$, where $f'$ is the [[形式导数|formal derivative]]: a [[Repeated root 重根|repeated root]] is a root of both. So $f$ has no multiple root exactly when $\gcd(f, f') = 1$, which is the test for a [[Separable polynomial]].

Euclid's algorithm works on the coefficients alone, so the GCD stays the same in every extension of the field.

---

*Source: [Polynomial greatest common divisor](https://en.wikipedia.org/wiki/Polynomial_greatest_common_divisor) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
