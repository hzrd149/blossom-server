var At = Object.defineProperty;
var Tt = (e, t) => {
  for (var r in t) At(e, r, { get: t[r], enumerable: !0 });
};
var ye = {};
Tt(ye, {
  button: () => gt,
  clearCache: () => zt,
  composeRef: () => ge,
  form: () => pt,
  input: () => ht,
  link: () => ut,
  meta: () => ft,
  script: () => lt,
  style: () => ct,
  title: () => at,
});
var ce = Symbol("RENDERER"),
  Z = Symbol("ERROR_HANDLER"),
  x = Symbol("STASH"),
  ue = Symbol("INTERNAL"),
  fe = Symbol("MEMO"),
  qe = Symbol("PERMALINK");
var ee = {
    title: [],
    script: ["src"],
    style: ["data-href"],
    link: ["href"],
    meta: ["name", "httpEquiv", "charset", "itemProp"],
  },
  ke = {},
  V = "data-precedence",
  Ae = (e) => e.rel === "stylesheet" && "precedence" in e,
  Te = (e, t) => e === "link" ? t : ee[e].length > 0;
var Re = (e) => Array.isArray(e) ? e : [e];
var Ot = new Map([
    ["className", "class"],
    ["htmlFor", "for"],
    ["crossOrigin", "crossorigin"],
    ["httpEquiv", "http-equiv"],
    ["itemProp", "itemprop"],
    ["fetchPriority", "fetchpriority"],
    ["noModule", "nomodule"],
    ["formAction", "formaction"],
  ]),
  de = (e) => Ot.get(e) || e,
  De = (e, t) => {
    for (let [r, n] of Object.entries(e)) {
      let s = r[0] === "-" || !/[A-Z]/.test(r)
        ? r
        : r.replace(/[A-Z]/g, (o) => `-${o.toLowerCase()}`);
      t(
        s,
        n == null ? null : typeof n == "number"
          ? s.match(
              /^(?:a|border-im|column(?:-c|s)|flex(?:$|-[^b])|grid-(?:ar|[^a])|font-w|li|or|sca|st|ta|wido|z)|ty$/,
            )
            ? `${n}`
            : `${n}px`
          : n,
      );
    }
  };
var Pe = (e) => (e[ue] = !0, e);
var Ve = (e) => ({ value: t, children: r }) => {
    if (!r) return;
    let n = {
      children: [{
        tag: Pe(() => {
          e.push(t);
        }),
        props: {},
      }],
    };
    Array.isArray(r) ? n.children.push(...r.flat()) : n.children.push(r),
      n.children.push({
        tag: Pe(() => {
          e.pop();
        }),
        props: {},
      });
    let s = { tag: "", props: n, type: "" };
    return s[Z] = (o) => {
      throw e.pop(), o;
    },
      s;
  },
  te = (e) => {
    let t = [e], r = Ve(t);
    return r.values = t, r.Provider = r, Q.push(r), r;
  };
var Q = [];
var H = (e) => e.values.at(-1);
var ne = "_hp",
  It = { Change: "Input", DoubleClick: "DblClick" },
  Lt = { svg: "2000/svg", math: "1998/Math/MathML" },
  F = [],
  Oe = new WeakMap(),
  J,
  Qe = () => J,
  $ = (e) => "t" in e,
  Me = { onClick: ["click", !1] },
  Ke = (e) => {
    if (!e.startsWith("on")) return;
    if (Me[e]) return Me[e];
    let t = e.match(/^on([A-Z][a-zA-Z]+?(?:PointerCapture)?)(Capture)?$/);
    if (t) {
      let [, r, n] = t;
      return Me[e] = [(It[r] || r).toLowerCase(), !!n];
    }
  },
  ze = (e, t) =>
    J && e instanceof SVGElement && /[A-Z]/.test(t) &&
      (t in e.style || t.match(/^(?:o|pai|str|u|ve)/))
      ? t.replace(/([A-Z])/g, "-$1").toLowerCase()
      : t,
  Nt = (e, t, r) => {
    t ||= {};
    for (let n in t) {
      let s = t[n];
      if (n !== "children" && (!r || r[n] !== s)) {
        n = de(n);
        let o = Ke(n);
        if (o) {
          if (
            r?.[n] !== s &&
            (r && e.removeEventListener(o[0], r[n], o[1]), s != null)
          ) {
            if (typeof s != "function") {
              throw new Error(`Event handler for "${n}" is not a function`);
            }
            e.addEventListener(o[0], s, o[1]);
          }
        } else if (n === "dangerouslySetInnerHTML" && s) e.innerHTML = s.__html;
        else if (n === "ref") {
          let l;
          typeof s == "function"
            ? l = s(e) || (() => s(null))
            : s && "current" in s &&
              (s.current = e, l = () => s.current = null), Oe.set(e, l);
        } else if (n === "style") {
          let l = e.style;
          typeof s == "string"
            ? l.cssText = s
            : (l.cssText = "", s != null && De(s, l.setProperty.bind(l)));
        } else {
          if (n === "value") {
            let u = e.nodeName;
            if (u === "INPUT" || u === "TEXTAREA" || u === "SELECT") {
              if (
                e.value = s == null || s === !1 ? null : s, u === "TEXTAREA"
              ) {
                e.textContent = s;
                continue;
              } else if (u === "SELECT") {
                e.selectedIndex === -1 && (e.selectedIndex = 0);
                continue;
              }
            }
          } else {(n === "checked" && e.nodeName === "INPUT" ||
              n === "selected" && e.nodeName === "OPTION") && (e[n] = s);}
          let l = ze(e, n);
          s == null || s === !1
            ? e.removeAttribute(l)
            : s === !0
            ? e.setAttribute(l, "")
            : typeof s == "string" || typeof s == "number"
            ? e.setAttribute(l, s)
            : e.setAttribute(l, s.toString());
        }
      }
    }
    if (r) {
      for (let n in r) {
        let s = r[n];
        if (n !== "children" && !(n in t)) {
          n = de(n);
          let o = Ke(n);
          o
            ? e.removeEventListener(o[0], s, o[1])
            : n === "ref"
            ? Oe.get(e)?.()
            : e.removeAttribute(ze(e, n));
        }
      }
    }
  },
  Ut = (e, t) => {
    t[x][0] = 0, F.push([e, t]);
    let r = t.tag[ce] || t.tag,
      n = r.defaultProps ? { ...r.defaultProps, ...t.props } : t.props;
    try {
      return [r.call(null, n)];
    } finally {
      F.pop();
    }
  },
  Je = (e, t, r, n, s) => {
    e.vR?.length && (n.push(...e.vR), delete e.vR),
      typeof e.tag == "function" && e[x][1][he]?.forEach((o) => s.push(o)),
      e.vC.forEach((o) => {
        if ($(o)) r.push(o);
        else if (typeof o.tag == "function" || o.tag === "") {
          o.c = t;
          let l = r.length;
          if (Je(o, t, r, n, s), o.s) {
            for (let u = l; u < r.length; u++) r[u].s = !0;
            o.s = !1;
          }
        } else r.push(o), o.vR?.length && (n.push(...o.vR), delete o.vR);
      });
  },
  _t = (e) => {
    for (; e && (e.tag === ne || !e.e);) {
      e = e.tag === ne || !e.vC?.[0] ? e.nN : e.vC[0];
    }
    return e?.e;
  },
  Ye = (e) => {
    $(e) ||
    (e[x]?.[1][he]?.forEach((t) => t[2]?.()),
      Oe.get(e.e)?.(),
      e.p === 2 && e.vC?.forEach((t) => t.p = 2),
      e.vC?.forEach(Ye)),
      e.p || (e.e?.remove(), delete e.e),
      typeof e.tag == "function" &&
      (re.delete(e), pe.delete(e), delete e[x][3], e.a = !0);
  },
  Ie = (e, t, r) => {
    e.c = t, et(e, t, r);
  },
  We = (e, t) => {
    if (t) {
      for (let r = 0, n = e.length; r < n; r++) {
        if (e[r] === t) return r;
      }
    }
  },
  Ge = Symbol(),
  et = (e, t, r) => {
    let n = [], s = [], o = [];
    Je(e, t, n, s, o), s.forEach(Ye);
    let l = r ? void 0 : t.childNodes, u, f = null;
    if (r) u = -1;
    else if (!l.length) u = 0;
    else {
      let c = We(l, _t(e.nN));
      c !== void 0
        ? (f = l[c], u = c)
        : u = We(l, n.find((p) => p.tag !== ne && p.e)?.e) ?? -1,
        u === -1 && (r = !0);
    }
    for (let c = 0, p = n.length; c < p; c++, u++) {
      let i = n[c], m;
      if (i.s && i.e) m = i.e, i.s = !1;
      else {
        let v = r || !i.e;
        $(i)
          ? (i.e && i.d && (i.e.textContent = i.t),
            i.d = !1,
            m = i.e ||= document.createTextNode(i.t))
          : (m = i.e ||= i.n
            ? document.createElementNS(i.n, i.tag)
            : document.createElement(i.tag),
            Nt(m, i.props, i.pP),
            et(i, m, v));
      }
      i.tag === ne
        ? u--
        : r
        ? m.parentNode || t.appendChild(m)
        : l[u] !== m && l[u - 1] !== m && (l[u + 1] === m
          ? t.appendChild(l[u])
          : t.insertBefore(m, f || l[u] || null));
    }
    if (e.pP && (e.pP = void 0), o.length) {
      let c = [], p = [];
      o.forEach(([, i, , m, v]) => {
        i && c.push(i), m && p.push(m), v?.();
      }),
        c.forEach((i) => i()),
        p.length && requestAnimationFrame(() => {
          p.forEach((i) => i());
        });
    }
  },
  $t = (e, t) =>
    !!(e && e.length === t.length && e.every((r, n) => r[1] === t[n][1])),
  pe = new WeakMap(),
  me = (e, t, r) => {
    let n = !r && t.pC;
    r && (t.pC ||= t.vC);
    let s;
    try {
      r ||= typeof t.tag == "function" ? Ut(e, t) : Re(t.props.children),
        r[0]?.tag === "" && r[0][Z] && (s = r[0][Z], e[5].push([e, s, t]));
      let o = n ? [...t.pC] : t.vC ? [...t.vC] : void 0, l = [], u;
      for (let f = 0; f < r.length; f++) {
        if (Array.isArray(r[f])) {
          r.splice(f, 1, ...r[f].flat(1 / 0)), f--;
          continue;
        }
        let c = tt(r[f]);
        if (c) {
          typeof c.tag == "function" && !c.tag[ue] &&
            (Q.length > 0 && (c[x][2] = Q.map((i) => [i, i.values.at(-1)])),
              e[5]?.length && (c[x][3] = e[5].at(-1)));
          let p;
          if (o && o.length) {
            let i = o.findIndex(
              $(c)
                ? (m) => $(m)
                : c.key !== void 0
                ? (m) => m.key === c.key && m.tag === c.tag
                : (m) => m.tag === c.tag,
            );
            i !== -1 && (p = o[i], o.splice(i, 1));
          }
          if (p) {
            if ($(c)) p.t !== c.t && (p.t = c.t, p.d = !0), c = p;
            else {
              let i = p.pP = p.props;
              if (
                p.props = c.props,
                  p.f ||= c.f || t.f,
                  typeof c.tag == "function"
              ) {
                let m = p[x][2];
                p[x][2] = c[x][2] || [],
                  p[x][3] = c[x][3],
                  !p.f && ((p.o || p) === c.o || p.tag[fe]?.(i, p.props)) &&
                  $t(m, p[x][2]) && (p.s = !0);
              }
              c = p;
            }
          } else if (!$(c) && J) {
            let i = H(J);
            i && (c.n = i);
          }
          if (
            !$(c) && !c.s && (me(e, c), delete c.f),
              l.push(c),
              u && !u.s && !c.s
          ) { for (let i = u; i && !$(i); i = i.vC?.at(-1)) i.nN = c; }
          u = c;
        }
      }
      t.vR = n ? [...t.vC, ...o || []] : o || [], t.vC = l, n && delete t.pC;
    } catch (o) {
      if (t.f = !0, o === Ge) {
        if (s) return;
        throw o;
      }
      let [l, u, f] = t[x]?.[3] || [];
      if (u) {
        let c = () => se([0, !1, e[2]], f), p = pe.get(f) || [];
        p.push(c), pe.set(f, p);
        let i = u(o, () => {
          let m = pe.get(f);
          if (m) {
            let v = m.indexOf(c);
            if (v !== -1) return m.splice(v, 1), c();
          }
        });
        if (i) {
          if (e[0] === 1) e[1] = !0;
          else if (me(e, f, [i]), (u.length === 1 || e !== l) && f.c) {
            Ie(f, f.c, !1);
            return;
          }
          throw Ge;
        }
      }
      throw o;
    } finally {
      s && e[5].pop();
    }
  },
  tt = (e) => {
    if (!(e == null || typeof e == "boolean")) {
      if (typeof e == "string" || typeof e == "number") {
        return { t: e.toString(), d: !0 };
      }
      if (
        "vR" in e &&
        (e = {
          tag: e.tag,
          props: e.props,
          key: e.key,
          f: e.f,
          type: e.tag,
          ref: e.props.ref,
          o: e.o || e,
        }), typeof e.tag == "function"
      ) e[x] = [0, []];
      else {
        let t = Lt[e.tag];
        t &&
          (J ||= te(""),
            e.props.children = [{
              tag: J,
              props: {
                value: e.n = `http://www.w3.org/${t}`,
                children: e.props.children,
              },
            }]);
      }
      return e;
    }
  },
  rt = (e, t, r) => {
    e.c === t && (e.c = r, e.vC.forEach((n) => rt(n, t, r)));
  },
  Xe = (e, t) => {
    t[x][2]?.forEach(([r, n]) => {
      r.values.push(n);
    });
    try {
      me(e, t, void 0);
    } catch {
      return;
    }
    if (t.a) {
      delete t.a;
      return;
    }
    t[x][2]?.forEach(([r]) => {
      r.values.pop();
    }), (e[0] !== 1 || !e[1]) && Ie(t, t.c, !1);
  },
  re = new WeakMap(),
  Ze = [],
  se = async (e, t) => {
    e[5] ||= [];
    let r = re.get(t);
    r && r[0](void 0);
    let n, s = new Promise((o) => n = o);
    if (
      re.set(t, [n, () => {
        e[2]
          ? e[2](e, t, (o) => {
            Xe(o, t);
          }).then(() => n(t))
          : (Xe(e, t), n(t));
      }]), Ze.length
    ) Ze.at(-1).add(t);
    else {
      await Promise.resolve();
      let o = re.get(t);
      o && (re.delete(t), o[1]());
    }
    return s;
  },
  Bt = (e, t) => {
    let r = [];
    r[5] = [], r[4] = !0, me(r, e, void 0), r[4] = !1;
    let n = document.createDocumentFragment();
    Ie(e, n, !0), rt(e, n, t), t.replaceChildren(n);
  },
  Le = (e, t) => {
    Bt(tt({ tag: "", props: { children: e } }), t);
  };
var Ne = (e, t, r) => ({ tag: ne, props: { children: e }, key: r, e: t, p: 1 });
var jt = 0,
  he = 1,
  Ht = 2,
  Ft = 3,
  qt = 4,
  Ue = new WeakMap(),
  _e = (e, t) =>
    !e || !t || e.length !== t.length || t.some((r, n) => r !== e[n]);
var Vt;
var nt = [];
var M = (e) => {
  let t = () => typeof e == "function" ? e() : e, r = F.at(-1);
  if (!r) return [t(), () => {}];
  let [, n] = r, s = n[x][1][jt] ||= [], o = n[x][0]++;
  return s[o] ||= [t(), (l) => {
    let u = Vt, f = s[o];
    if (typeof l == "function" && (l = l(f[0])), !Object.is(l, f[0])) {
      if (f[0] = l, nt.length) {
        let [c, p] = nt.at(-1);
        Promise.all([c === 3 ? n : se([c, !1, u], n), p]).then(([i]) => {
          if (!i || !(c === 2 || c === 3)) {
            return;
          }
          let m = i.vC;
          requestAnimationFrame(() => {
            setTimeout(() => {
              m === i.vC && se([c === 3 ? 1 : 0, !1, u], i);
            });
          });
        });
      } else se([0, !1, u], n);
    }
  }];
};
var Kt = (e, t, r) => {
    let n = F.at(-1);
    if (!n) return;
    let [, s] = n,
      o = s[x][1][he] ||= [],
      l = s[x][0]++,
      [u, , f] = o[l] ||= [];
    if (_e(u, r)) {
      f && f();
      let c = () => {
          p[e] = void 0, p[2] = t();
        },
        p = [r, void 0, void 0, void 0, void 0];
      p[e] = c, o[l] = p;
    }
  },
  oe = (e, t) => Kt(3, e, t);
var b = (e, t) => {
    let r = F.at(-1);
    if (!r) return e;
    let [, n] = r, s = n[x][1][Ht] ||= [], o = n[x][0]++, l = s[o];
    return _e(l?.[1], t) ? s[o] = [e, t] : e = s[o][0], e;
  },
  ie = (e) => {
    let t = F.at(-1);
    if (!t) return { current: e };
    let [, r] = t, n = r[x][1][qt] ||= [], s = r[x][0]++;
    return n[s] ||= { current: e };
  },
  $e = (e) => {
    let t = Ue.get(e);
    if (t) {
      if (t.length === 2) throw t[1];
      return t[0];
    }
    throw e.then((r) => Ue.set(e, [r]), (r) => Ue.set(e, [void 0, r])), e;
  },
  Be = (e, t) => {
    let r = F.at(-1);
    if (!r) return e();
    let [, n] = r, s = n[x][1][Ft] ||= [], o = n[x][0]++, l = s[o];
    return _e(l?.[1], t) && (s[o] = [e(), t]), s[o][0];
  };
var ot = te({ pending: !1, data: null, method: null, action: null }),
  st = new Set(),
  it = (e) => {
    st.add(e), e.finally(() => st.delete(e));
  };
var zt = () => {
    je = Object.create(null), He = Object.create(null);
  },
  ge = (e, t) =>
    Be(() => (r) => {
      let n;
      e && (typeof e == "function"
        ? n = e(r) || (() => {
          e(null);
        })
        : e && "current" in e && (e.current = r,
          n = () => {
            e.current = null;
          }));
      let s = t(r);
      return () => {
        s?.(), n?.();
      };
    }, [e]),
  je = Object.create(null),
  He = Object.create(null),
  ae = (e, t, r, n, s) => {
    if (t?.itemProp) return { tag: e, props: t, type: e, ref: t.ref };
    let o = document.head,
      { onLoad: l, onError: u, precedence: f, blocking: c, ...p } = t,
      i = null,
      m = !1,
      v = ee[e],
      R = Te(e, n),
      B = (y) =>
        y.getAttribute("rel") === "stylesheet" && y.getAttribute(V) !== null,
      I;
    if (R) {
      let y = o.querySelectorAll(e);
      e: for (let C of y) {
        if (!(e === "link" && !B(C))) {
          for (let g of v) {
            if (C.getAttribute(g) === t[g]) {
              i = C;
              break e;
            }
          }
        }
      }
      if (!i) {
        let C = v.reduce(
          (g, w) => t[w] === void 0 ? g : `${g}-${w}-${t[w]}`,
          e,
        );
        m = !He[C],
          i = He[C] ||= (() => {
            let g = document.createElement(e);
            for (let w of v) t[w] !== void 0 && g.setAttribute(w, t[w]);
            return t.rel && g.setAttribute("rel", t.rel), g;
          })();
      }
    } else I = o.querySelectorAll(e);
    f = n ? f ?? "" : void 0, n && (p[V] = f);
    let z = b((y) => {
        if (R) {
          if (e === "link" && f !== void 0) {
            let g = !1;
            for (let w of o.querySelectorAll(e)) {
              let O = w.getAttribute(V);
              if (O === null) {
                o.insertBefore(y, w);
                return;
              }
              if (g && O !== f) {
                o.insertBefore(y, w);
                return;
              }
              O === f && (g = !0);
            }
            o.appendChild(y);
            return;
          }
          let C = !1;
          for (let g of o.querySelectorAll(e)) {
            if (C && g.getAttribute(V) !== f) {
              o.insertBefore(y, g);
              return;
            }
            g.getAttribute(V) === f && (C = !0);
          }
          o.appendChild(y);
        } else if (e === "link") o.contains(y) || o.appendChild(y);
        else if (I) {
          let C = !1;
          for (let g of I) {
            if (g === y) {
              C = !0;
              break;
            }
          }
          C || o.insertBefore(y, o.contains(I[0]) ? I[0] : o.querySelector(e)),
            I = void 0;
        }
      }, [R, f, e]),
      N = ge(t.ref, (y) => {
        let C = v[0];
        if (r === 2 && (y.innerHTML = ""), (m || I) && z(y), !u && !l || !C) {
          return;
        }
        let g = je[y.getAttribute(C)] ||= new Promise((w, O) => {
          y.addEventListener("load", w), y.addEventListener("error", O);
        });
        l && (g = g.then(l)), u && (g = g.catch(u)), g.catch(() => {});
      });
    if (s && c === "render") {
      let y = ee[e][0];
      if (y && t[y]) {
        let C = t[y],
          g = je[C] ||= new Promise((w, O) => {
            z(i), i.addEventListener("load", w), i.addEventListener("error", O);
          });
        $e(g);
      }
    }
    let q = { tag: e, type: e, props: { ...p, ref: N }, ref: N };
    return q.p = r, i && (q.e = i), Ne(q, o);
  },
  at = (e) => {
    let t = Qe();
    return (t && H(t))?.endsWith("svg")
      ? { tag: "title", props: e, type: "title", ref: e.ref }
      : ae("title", e, void 0, !1, !1);
  },
  lt = (e) =>
    !e || ["src", "async"].some((t) => !e[t])
      ? { tag: "script", props: e, type: "script", ref: e.ref }
      : ae("script", e, 1, !1, !0),
  ct = (e) =>
    !e || !["href", "precedence"].every((t) => t in e)
      ? { tag: "style", props: e, type: "style", ref: e.ref }
      : (e["data-href"] = e.href, delete e.href, ae("style", e, 2, !0, !0)),
  ut = (e) =>
    !e || ["onLoad", "onError"].some((t) => t in e) ||
      e.rel === "stylesheet" && (!("precedence" in e) || "disabled" in e)
      ? { tag: "link", props: e, type: "link", ref: e.ref }
      : ae("link", e, 1, Ae(e), !0),
  ft = (e) => ae("meta", e, void 0, !1, !1),
  dt = Symbol(),
  pt = (e) => {
    let { action: t, ...r } = e;
    typeof t != "function" && (r.action = t);
    let [n, s] = M([null, !1]),
      o = b(async (c) => {
        let p = c.isTrusted ? t : c.detail[dt];
        if (typeof p != "function") return;
        c.preventDefault();
        let i = new FormData(c.target);
        s([i, !0]);
        let m = p(i);
        m instanceof Promise && (it(m), await m), s([null, !0]);
      }, []),
      l = ge(e.ref, (c) => (c.addEventListener("submit", o), () => {
        c.removeEventListener("submit", o);
      })),
      [u, f] = n;
    return n[1] = !1, {
      tag: ot,
      props: {
        value: {
          pending: u !== null,
          data: u,
          method: u ? "post" : null,
          action: u ? t : null,
        },
        children: {
          tag: "form",
          props: { ...r, ref: l },
          type: "form",
          ref: l,
        },
      },
      f,
    };
  },
  mt = (e, { formAction: t, ...r }) => {
    if (typeof t == "function") {
      let n = b((s) => {
        s.preventDefault(),
          s.currentTarget.form.dispatchEvent(
            new CustomEvent("submit", { detail: { [dt]: t } }),
          );
      }, []);
      r.ref = ge(r.ref, (s) => (s.addEventListener("click", n), () => {
        s.removeEventListener("click", n);
      }));
    }
    return { tag: e, props: r, type: e, ref: r.ref };
  },
  ht = (e) => mt("input", e),
  gt = (e) => mt("button", e);
Object.assign(ke, {
  title: at,
  script: lt,
  style: ct,
  link: ut,
  meta: ft,
  form: pt,
  input: ht,
  button: gt,
});
var a = (
    e,
    t,
    r,
  ) => (typeof e == "string" && ye[e] && (e = ye[e]),
    { tag: e, type: e, props: t, key: r, ref: t.ref }),
  Y = (e) => a("", e, void 0);
var yt = /\b([0-9a-f]{64})\b/i;
function Wt(e) {
  let t = e.trim();
  if (!t) return null;
  if (/^blossom:/i.test(t)) {
    let r = t.slice(8), n = r.split(/[.?]/)[0], s = yt.exec(n);
    if (!s) return null;
    let o = s[1].toLowerCase(),
      l = r.indexOf("."),
      u = l >= 0 ? r.slice(l) : "",
      f = u.indexOf("?"),
      c = f >= 0 ? u.slice(0, f) : u,
      p = f >= 0 ? u.slice(f + 1) : "",
      i,
      v = new URLSearchParams(p).get("xs");
    return v
      ? i = `${
        (/^https?:\/\//i.test(v) ? v : `https://${v}`).replace(/\/$/, "")
      }/${o}${c || ""}`
      : i = t,
      { displayUrl: t, mirrorUrl: i, sha256: o };
  }
  try {
    let r = new URL(t);
    if (r.protocol === "http:" || r.protocol === "https:") {
      let n = yt.exec(r.pathname);
      if (n) return { displayUrl: t, mirrorUrl: t, sha256: n[1].toLowerCase() };
    }
  } catch {
    let r = t.split(/[?#]/)[0];
    if (/^[0-9a-f]{64}$/i.test(r)) {
      return { displayUrl: t, mirrorUrl: t, sha256: r.toLowerCase() };
    }
  }
  return null;
}
async function Gt(e) {
  let t = await e.arrayBuffer(), r = await crypto.subtle.digest("SHA-256", t);
  return Array.from(new Uint8Array(r)).map((n) =>
    n.toString(16).padStart(2, "0")
  ).join("");
}
function Xt(e) {
  if (e === 0) return "0 B";
  let t = ["B", "KB", "MB", "GB"],
    r = Math.floor(Math.log(e) / Math.log(1024)),
    n = e / Math.pow(1024, r);
  return `${n % 1 === 0 ? n : n.toFixed(2)} ${t[r]}`;
}
function xt(e) {
  return e.type.startsWith("image/") || e.type.startsWith("video/");
}
function Zt(e, t, r, n) {
  return new Promise((s, o) => {
    let l = new XMLHttpRequest();
    l.upload.onprogress = (u) => {
      u.lengthComputable && n(Math.round(u.loaded / u.total * 100));
    },
      l.onload = () => {
        if (l.status >= 200 && l.status < 300) {
          try {
            s(JSON.parse(l.responseText));
          } catch {
            o(new Error("Invalid server response"));
          }
        } else {
          let u = l.getResponseHeader("X-Reason") ?? l.statusText;
          o(new Error(`Failed (${l.status}): ${u}`));
        }
      },
      l.onerror = () => o(new Error("Network error")),
      l.open("PUT", e);
    for (let [u, f] of Object.entries(r)) l.setRequestHeader(u, f);
    l.send(t);
  });
}
async function bt(e, t) {
  let r = { "Content-Type": "application/json" };
  t && (r.Authorization = t);
  let n = await fetch("/mirror", {
    method: "PUT",
    headers: r,
    body: JSON.stringify({ url: e }),
  });
  if (!n.ok) {
    let s = n.headers.get("X-Reason") ?? n.statusText;
    throw new Error(`Failed (${n.status}): ${s}`);
  }
  return n.json();
}
async function Qt(e, t) {
  let r = new Map();
  for (let n of e) {
    t(n.id, "hashing");
    let s = await Gt(n.file);
    r.set(n.id, s);
  }
  return r;
}
var xe = 60;
async function vt(e, t, r, n) {
  let s = Math.floor(Date.now() / 1e3) + 300,
    o = await e.signEvent({
      kind: 24242,
      content: n,
      created_at: Math.floor(Date.now() / 1e3),
      tags: [["t", r], ...t.map((l) => ["x", l]), ["expiration", String(s)]],
    });
  return "Nostr " + btoa(JSON.stringify(o));
}
var Jt = {
    pending: "Pending",
    hashing: "Hashing...",
    signing: "Signing...",
    uploading: "Uploading",
    done: "Done",
    error: "Error",
  },
  Yt = {
    pending: "Pending",
    signing: "Signing...",
    mirroring: "Mirroring...",
    done: "Done",
    error: "Error",
  },
  Et = {
    pending: "bg-gray-700 text-gray-300",
    hashing: "bg-blue-900 text-blue-300",
    signing: "bg-purple-900 text-purple-300",
    uploading: "bg-blue-900 text-blue-300",
    mirroring: "bg-blue-900 text-blue-300",
    done: "bg-green-900 text-green-300",
    error: "bg-red-900 text-red-300",
  };
function er({ uf: e, onRemove: t, onCopy: r }) {
  let n = e.status === "uploading" || e.status === "done",
    s = e.status === "done" ? 100 : e.progress;
  return a("div", {
    class: "bg-gray-800 rounded-lg px-4 py-3 space-y-2 min-w-0",
    children: [
      a("div", {
        class: "flex items-center gap-2 min-w-0",
        children: [
          a("span", {
            class: "flex-1 text-sm text-white truncate font-medium min-w-0",
            title: e.file.name,
            children: e.file.name,
          }),
          a("span", {
            class:
              "shrink-0 text-xs text-gray-400 tabular-nums whitespace-nowrap",
            children: Xt(e.file.size),
          }),
          e.status === "pending" &&
          a("button", {
            type: "button",
            class:
              "shrink-0 text-gray-500 hover:text-red-400 text-sm px-2 py-1 rounded hover:bg-gray-700",
            onClick: () => t(e.id),
            title: "Remove",
            children: "\u2715",
          }),
        ],
      }),
      e.status !== "pending" && a("div", {
        class: "flex items-center gap-2 min-w-0",
        children: [
          a("span", {
            class: `shrink-0 text-xs font-semibold px-2 py-0.5 rounded ${
              Et[e.status]
            }`,
            children: [Jt[e.status], e.status === "uploading" && ` ${s}%`],
          }),
          e.status === "done" && e.result && a(Y, {
            children: [
              a("span", {
                class:
                  "flex-1 text-xs text-gray-500 font-mono truncate min-w-0",
                children: e.result.url,
              }),
              a("button", {
                type: "button",
                class:
                  "shrink-0 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-2 py-0.5 rounded whitespace-nowrap",
                onClick: () => r(e.result.url),
                children: "Copy",
              }),
            ],
          }),
          e.status === "error" && e.error &&
          a("span", {
            class: "flex-1 text-xs text-red-400 min-w-0 break-words",
            children: e.error,
          }),
        ],
      }),
      n && a("div", {
        class: "w-full bg-gray-700 rounded-full h-1.5",
        children: a("div", {
          class: `h-1.5 rounded-full transition-all duration-200 ${
            e.status === "done" ? "bg-green-500" : "bg-blue-500"
          }`,
          style: `width:${s}%`,
        }),
      }),
    ],
  });
}
function tr({ item: e, onRemove: t, onCopy: r }) {
  return a("div", {
    class: "bg-gray-800 rounded-lg px-4 py-3 space-y-2 min-w-0",
    children: [
      a("div", {
        class: "flex items-center gap-2 min-w-0",
        children: [
          a("span", {
            class: "flex-1 text-xs text-gray-400 font-mono truncate min-w-0",
            title: e.displayUrl,
            children: e.displayUrl,
          }),
          e.status === "pending" &&
          a("button", {
            type: "button",
            class:
              "shrink-0 text-gray-500 hover:text-red-400 text-sm px-2 py-1 rounded hover:bg-gray-700",
            onClick: () => t(e.id),
            title: "Remove",
            children: "\u2715",
          }),
        ],
      }),
      e.status !== "pending" && a("div", {
        class: "flex items-center gap-2 min-w-0",
        children: [
          a("span", {
            class: `shrink-0 text-xs font-semibold px-2 py-0.5 rounded ${
              Et[e.status]
            }`,
            children: Yt[e.status],
          }),
          e.status === "done" && e.result && a(Y, {
            children: [
              a("span", {
                class:
                  "flex-1 text-xs text-gray-500 font-mono truncate min-w-0",
                children: e.result.url,
              }),
              a("button", {
                type: "button",
                class:
                  "shrink-0 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-2 py-0.5 rounded whitespace-nowrap",
                onClick: () => r(e.result.url),
                children: "Copy",
              }),
            ],
          }),
          e.status === "error" && e.error &&
          a("span", {
            class: "flex-1 text-xs text-red-400 min-w-0 break-words",
            children: e.error,
          }),
        ],
      }),
    ],
  });
}
function rr(
  { requireAuth: e, mediaEnabled: t, mediaRequireAuth: r, onQueueChange: n },
) {
  let [s, o] = M([]),
    [l, u] = M(!1),
    [f, c] = M(!1),
    [p, i] = M(3),
    m = ie(0),
    v = ie([]);
  v.current = s,
    oe(() => {
      n(s.length > 0);
    }, [s.length, n]);
  let R = b((d, E) => {
      o((j) => j.map((T) => T.id === d ? { ...T, ...E } : T));
    }, []),
    B = b((d) => {
      let j = Array.from(d).map((T) => ({
        id: crypto.randomUUID(),
        file: T,
        status: "pending",
        progress: 0,
        optimize: f && t && xt(T),
      }));
      o((T) => [...T, ...j]);
    }, [f, t]),
    I = b((d) => o((E) => E.filter((j) => j.id !== d)), []),
    z = b(() => {
      o((d) => d.filter((E) => E.status !== "done" && E.status !== "error"));
    }, []),
    N = b((d) => {
      navigator.clipboard.writeText(d).catch(() => {});
    }, []),
    q = b((d) => {
      d.preventDefault(),
        u(!1),
        d.dataTransfer?.files.length && B(d.dataTransfer.files);
    }, [B]),
    y = b((d) => {
      d.preventDefault(), u(!0);
    }, []),
    C = b(() => u(!1), []),
    g = b((d) => {
      let E = d.target.files;
      E?.length && (B(E), d.target.value = "");
    }, [B]),
    w = b(async (d, E) => {
      let j = d.optimize ? "/media" : "/upload";
      try {
        R(d.id, { status: "uploading", progress: 0 });
        let T = { "Content-Type": d.file.type || "application/octet-stream" };
        E && (T.Authorization = E);
        let be = await Zt(j, d.file, T, (ve) => R(d.id, { progress: ve }));
        R(d.id, { status: "done", progress: 100, result: be });
      } catch (T) {
        R(d.id, {
          status: "error",
          error: T instanceof Error ? T.message : String(T),
        });
      }
    }, [R]),
    O = b(async () => {
      let E = v.current.filter((P) => P.status === "pending");
      if (E.length === 0) return;
      if (!E.some((P) => P.optimize ? r : e)) {
        let P = Math.max(0, p - m.current), Ee = E.slice(0, P);
        for (let we of Ee) {
          m.current++,
            w(we, void 0).finally(() => {
              m.current--, O();
            });
        }
        return;
      }
      let T = globalThis.nostr;
      if (!T) {
        for (let P of E) {
          R(P.id, {
            status: "error",
            error: "No Nostr extension detected. Install Alby or nos2x.",
          });
        }
        return;
      }
      let be = E.filter((P) => !P.optimize), ve = E.filter((P) => P.optimize);
      for (
        let [P, Ee, we] of [[be, "upload", "Upload files"], [
          ve,
          "media",
          "Optimize and upload media",
        ]]
      ) {
        if (P.length === 0) continue;
        let wt = await Qt(P, (G, X) => R(G, { status: X }));
        for (let G = 0; G < P.length; G += xe) {
          let X = P.slice(G, G + xe), Ct = X.map((_) => wt.get(_.id));
          for (let _ of X) R(_.id, { status: "signing" });
          let Fe;
          try {
            Fe = await vt(T, Ct, Ee, we);
          } catch (_) {
            let Ce = _ instanceof Error ? _.message : String(_);
            for (let kt of X) R(kt.id, { status: "error", error: Ce });
            continue;
          }
          let St = async (_) => {
            for (; m.current >= p;) {
              await new Promise((Ce) => setTimeout(Ce, 50));
            }
            m.current++;
            try {
              await w(_, Fe);
            } finally {
              m.current--;
            }
          };
          await Promise.all(X.map(St));
        }
      }
    }, [e, r, p, R, w]),
    h = b(() => O(), [O]),
    S = s.some((d) =>
      d.status === "hashing" || d.status === "signing" ||
      d.status === "uploading"
    ),
    L = s.some((d) => d.status === "done" || d.status === "error"),
    k = s.some((d) => d.status === "pending"),
    A = t && s.some((d) => xt(d.file)),
    le = s.length > 0 &&
      s.every((d) => d.status === "done" || d.status === "error"),
    W = k && !S,
    D = s.filter((d) => d.status === "done" && d.result).map((d) =>
      d.result.url
    ),
    U = b(() => {
      navigator.clipboard.writeText(D.join(`
`)).catch(() => {});
    }, [D]);
  return a("div", {
    class: "p-6 space-y-4",
    children: [
      s.length > 0 && a("div", {
        class: "flex flex-wrap items-center gap-4",
        children: [
          a("label", {
            class: "flex items-center gap-2 text-sm text-gray-400",
            children: [
              a("span", { children: "Concurrent uploads" }),
              a("input", {
                type: "number",
                min: "1",
                max: "10",
                value: p,
                disabled: S,
                class:
                  "w-14 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-sm text-center disabled:opacity-50",
                onChange: (d) => {
                  let E = parseInt(d.target.value, 10);
                  E >= 1 && E <= 10 && i(E);
                },
              }),
            ],
          }),
          A && a("label", {
            class:
              "flex items-center gap-2 cursor-pointer select-none text-sm text-gray-400",
            children: [
              a("input", {
                type: "checkbox",
                class: "w-4 h-4 rounded accent-blue-500",
                checked: f,
                disabled: S,
                onChange: (d) => c(d.target.checked),
              }),
              a("span", {
                children: [
                  "Optimize media",
                  a("span", {
                    class: "ml-1 text-gray-500 text-xs",
                    children: "(via /media)",
                  }),
                ],
              }),
            ],
          }),
          L && !S &&
          a("button", {
            type: "button",
            class:
              "ml-auto text-xs text-gray-500 hover:text-gray-300 underline",
            onClick: z,
            children: "Clear finished",
          }),
        ],
      }),
      a("label", {
        class:
          `block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            l
              ? "border-blue-500 bg-blue-950"
              : "border-gray-700 hover:border-gray-500"
          }`,
        onDragOver: y,
        onDragLeave: C,
        onDrop: q,
        children: [
          a("input", {
            type: "file",
            multiple: !0,
            class: "sr-only",
            onChange: g,
          }),
          s.length > 0
            ? a("p", {
              class: "text-sm text-gray-400",
              children: "Drop more files or click to add",
            })
            : a("div", {
              class: "space-y-2",
              children: [
                a("p", {
                  class: "text-gray-300",
                  children: "Drop files here or click to select",
                }),
                a("p", {
                  class: "text-xs text-gray-500",
                  children: e
                    ? "Nostr extension required to sign uploads"
                    : "No auth required",
                }),
              ],
            }),
        ],
      }),
      s.length > 0 &&
      a("div", {
        class: "space-y-2",
        children: s.map((d) => a(er, { uf: d, onRemove: I, onCopy: N }, d.id)),
      }),
      s.length > 0 && a("button", {
        type: "button",
        class: `w-full py-3 rounded-xl font-semibold transition-colors ${
          W
            ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
            : "bg-gray-800 text-gray-500 cursor-not-allowed"
        }`,
        onClick: h,
        disabled: !W,
        children: S
          ? "Uploading\u2026"
          : W
          ? `Upload ${s.filter((d) => d.status === "pending").length} file${
            s.filter((d) => d.status === "pending").length === 1 ? "" : "s"
          }`
          : le
          ? "All done"
          : "Upload",
      }),
      le && a("div", {
        class: "flex items-center justify-between gap-4",
        children: [
          a("p", {
            class: "text-sm text-gray-500",
            children: [
              s.filter((d) => d.status === "done").length,
              " succeeded \xB7",
              " ",
              s.filter((d) => d.status === "error").length,
              " failed",
            ],
          }),
          D.length > 0 &&
          a("button", {
            type: "button",
            class:
              "shrink-0 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700",
            onClick: U,
            children: "Copy all URLs",
          }),
        ],
      }),
    ],
  });
}
function nr({ requireAuth: e, onQueueChange: t }) {
  let [r, n] = M("input"),
    [s, o] = M(""),
    [l, u] = M(null),
    [f, c] = M([]),
    p = ie([]);
  p.current = f,
    oe(() => {
      t(r === "list" && f.length > 0);
    }, [r, f.length, t]);
  let i = b((h, S) => {
      c((L) => L.map((k) => k.id === h ? { ...k, ...S } : k));
    }, []),
    m = b(() => {
      let h = s.split(/[\n,]+/), S = [], L = new Set();
      for (let k of h) {
        let A = Wt(k);
        A &&
          (L.has(A.sha256) ||
            (L.add(A.sha256),
              S.push({
                id: crypto.randomUUID(),
                displayUrl: A.displayUrl,
                mirrorUrl: A.mirrorUrl,
                sha256: A.sha256,
                status: "pending",
              })));
      }
      if (S.length === 0) {
        u("No valid Blossom URLs or blossom:// URIs found. Each must contain a 64-character hex hash.");
        return;
      }
      u(null), c(S), n("list");
    }, [s]),
    v = b(() => {
      n("input"), c([]);
    }, []),
    R = b((h) => c((S) => S.filter((L) => L.id !== h)), []),
    B = b((h) => {
      navigator.clipboard.writeText(h).catch(() => {});
    }, []),
    I = b(() => {
      c((h) => h.filter((S) => S.status !== "done" && S.status !== "error"));
    }, []),
    z = b(async () => {
      let S = p.current.filter((k) => k.status === "pending");
      if (S.length === 0) return;
      if (!e) {
        await Promise.all(S.map(async (k) => {
          i(k.id, { status: "mirroring" });
          try {
            let A = await bt(k.mirrorUrl);
            i(k.id, { status: "done", result: A });
          } catch (A) {
            i(k.id, {
              status: "error",
              error: A instanceof Error ? A.message : String(A),
            });
          }
        }));
        return;
      }
      let L = globalThis.nostr;
      if (!L) {
        for (let k of S) {
          i(k.id, {
            status: "error",
            error: "No Nostr extension detected. Install Alby or nos2x.",
          });
        }
        return;
      }
      for (let k = 0; k < S.length; k += xe) {
        let A = S.slice(k, k + xe), le = A.map((D) => D.sha256);
        for (let D of A) i(D.id, { status: "signing" });
        let W;
        try {
          W = await vt(L, le, "upload", "Mirror blobs");
        } catch (D) {
          let U = D instanceof Error ? D.message : String(D);
          for (let d of A) i(d.id, { status: "error", error: U });
          continue;
        }
        await Promise.all(A.map(async (D) => {
          i(D.id, { status: "mirroring" });
          try {
            let U = await bt(D.mirrorUrl, W);
            i(D.id, { status: "done", result: U });
          } catch (U) {
            i(D.id, {
              status: "error",
              error: U instanceof Error ? U.message : String(U),
            });
          }
        }));
      }
    }, [e, i]),
    N = f.some((h) => h.status === "signing" || h.status === "mirroring"),
    q = f.some((h) => h.status === "pending"),
    y = f.some((h) => h.status === "done" || h.status === "error"),
    C = f.length > 0 &&
      f.every((h) => h.status === "done" || h.status === "error"),
    g = q && !N,
    w = f.filter((h) => h.status === "done" && h.result).map((h) =>
      h.result.url
    ),
    O = b(() => {
      navigator.clipboard.writeText(w.join(`
`)).catch(() => {});
    }, [w]);
  return r === "input"
    ? a("div", {
      class: "p-6 space-y-4",
      children: [
        a("p", {
          class: "text-sm text-gray-400",
          children: [
            "Paste Blossom URLs or",
            " ",
            a("code", {
              class: "text-gray-300 bg-gray-800 px-1 rounded",
              children: "blossom://",
            }),
            " ",
            "URIs below, one per line (or comma-separated).",
          ],
        }),
        a("textarea", {
          class:
            "w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm font-mono rounded-lg px-3 py-2 resize-y min-h-32 focus:outline-none focus:border-gray-500 placeholder-gray-600",
          placeholder: `https://cdn.example.com/abc123...def456.jpg
blossom://abc123...def456
abc123...def456`,
          value: s,
          onInput: (h) => o(h.target.value),
        }),
        l &&
        a("p", {
          class:
            "text-xs text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2",
          children: l,
        }),
        a("button", {
          type: "button",
          class: `w-full py-3 rounded-xl font-semibold transition-colors ${
            s.trim()
              ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
              : "bg-gray-800 text-gray-500 cursor-not-allowed"
          }`,
          disabled: !s.trim(),
          onClick: m,
          children: "Next",
        }),
      ],
    })
    : a("div", {
      class: "p-6 space-y-4",
      children: [
        a("div", {
          class: "flex items-center justify-between",
          children: [
            a("p", {
              class: "text-sm text-gray-400",
              children: [
                f.length,
                " blob",
                f.length === 1 ? "" : "s",
                " to mirror",
                e &&
                a("span", {
                  class: "ml-2 text-xs text-gray-500",
                  children: "\xB7 auth required",
                }),
              ],
            }),
            !N &&
            a("button", {
              type: "button",
              class: "text-xs text-gray-500 hover:text-gray-300 underline",
              onClick: v,
              children: "\u2190 Edit URLs",
            }),
          ],
        }),
        y && !N &&
        a("div", {
          class: "flex justify-end",
          children: a("button", {
            type: "button",
            class: "text-xs text-gray-500 hover:text-gray-300 underline",
            onClick: I,
            children: "Clear finished",
          }),
        }),
        a("div", {
          class: "space-y-2",
          children: f.map((h) =>
            a(tr, { item: h, onRemove: R, onCopy: B }, h.id)
          ),
        }),
        a("button", {
          type: "button",
          class: `w-full py-3 rounded-xl font-semibold transition-colors ${
            g
              ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
              : "bg-gray-800 text-gray-500 cursor-not-allowed"
          }`,
          onClick: z,
          disabled: !g,
          children: N
            ? "Mirroring\u2026"
            : g
            ? `Mirror ${f.filter((h) => h.status === "pending").length} blob${
              f.filter((h) => h.status === "pending").length === 1 ? "" : "s"
            }`
            : C
            ? "All done"
            : "Mirror",
        }),
        C && a("div", {
          class: "flex items-center justify-between gap-4",
          children: [
            a("p", {
              class: "text-sm text-gray-500",
              children: [
                f.filter((h) => h.status === "done").length,
                " succeeded \xB7",
                " ",
                f.filter((h) => h.status === "error").length,
                " failed",
              ],
            }),
            w.length > 0 &&
            a("button", {
              type: "button",
              class:
                "shrink-0 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700",
              onClick: O,
              children: "Copy all URLs",
            }),
          ],
        }),
      ],
    });
}
function sr(
  {
    requireAuth: e,
    mediaEnabled: t,
    mediaRequireAuth: r,
    mirrorEnabled: n,
    mirrorRequireAuth: s,
  },
) {
  let [o, l] = M("upload"), [u, f] = M(!1), [c, p] = M(!1), i = u || c;
  oe(() => {
    let v = document.getElementById("server-info");
    v && (v.style.display = i ? "none" : "");
  }, [i]);
  let m = (v) =>
    `px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
      o === v
        ? "border-blue-500 text-white"
        : "border-transparent text-gray-500 hover:text-gray-300"
    }`;
  return a("div", {
    children: [
      n && a("div", {
        class: "flex border-b border-gray-800 px-6 pt-4",
        children: [
          a("button", {
            type: "button",
            class: m("upload"),
            onClick: () => l("upload"),
            children: "Upload",
          }),
          a("button", {
            type: "button",
            class: m("mirror"),
            onClick: () => l("mirror"),
            children: "Mirror",
          }),
        ],
      }),
      o === "upload" &&
      a(rr, {
        requireAuth: e,
        mediaEnabled: t,
        mediaRequireAuth: r,
        onQueueChange: f,
      }),
      o === "mirror" && n && a(nr, { requireAuth: s, onQueueChange: p }),
    ],
  });
}
var K = document.getElementById("upload-root");
K && Le(
  a(sr, {
    requireAuth: K.dataset.requireAuth === "true",
    mediaEnabled: K.dataset.mediaEnabled === "true",
    mediaRequireAuth: K.dataset.mediaRequireAuth === "true",
    mirrorEnabled: K.dataset.mirrorEnabled === "true",
    mirrorRequireAuth: K.dataset.mirrorRequireAuth === "true",
  }),
  K,
);
