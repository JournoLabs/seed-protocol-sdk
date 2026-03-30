import Te, { useState as w, useRef as F, useMemo as D, useEffect as I, useCallback as x, useLayoutEffect as Ve } from "react";
import { flushSync as de } from "react-dom";
import { getClient as me, ClientManagerState as C, BaseDb as W, Item as Ne, getAddressesForItemsFilter as Ke, seeds as A, getVersionData as je, createNewItem as We, ItemProperty as se, metadata as T, appState as ue, Schema as he, schemas as Y, loadAllSchemasFromDb as Ge, SEED_PROTOCOL_SCHEMA_NAME as Je, Model as oe, models as ae, modelSchemas as ge, ModelProperty as fe, properties as ee, getPropertySchema as ke, getSchemaNameFromId as Ye, BaseFileManager as j, eventEmitter as K, client as Xe } from "@seedprotocol/sdk";
import { orderBy as Ze, debounce as $e, startCase as _e } from "lodash-es";
import J from "debug";
import { useSelector as we } from "@xstate/react";
import { or as te, isNull as le, eq as O, inArray as De, sql as et, isNotNull as Ie, and as Ee, gt as tt, like as Be, desc as rt } from "drizzle-orm";
import { toSnakeCase as nt } from "drizzle-orm/casing";
import { useQueryClient as X, useQuery as Z, QueryClient as st, QueryClientProvider as ot } from "@tanstack/react-query";
import it from "pluralize";
import { jsxs as U, jsx as S } from "react/jsx-runtime";
const z = () => {
  const r = me().getService();
  return we(r, (n) => n.value === C.IDLE);
};
function ie(e) {
  const [r, t] = w(void 0), n = F(null), i = z(), a = D(() => {
    if (!i || !e)
      return null;
    try {
      return W.liveQuery(e);
    } catch (o) {
      return console.error("[useLiveQuery] Failed to create live query:", o), null;
    }
  }, [e, i]);
  return I(() => {
    if (n.current && (n.current.unsubscribe(), n.current = null), !a)
      return;
    const o = a.subscribe({
      next: (l) => {
        t(l !== void 0 ? [...l] : void 0);
      },
      error: (l) => {
        console.error("[useLiveQuery] Error:", l);
      }
    });
    return n.current = o, () => {
      n.current && (n.current.unsubscribe(), n.current = null);
    };
  }, [a]), r;
}
const pe = J("seedSdk:react:item"), jt = ({ modelName: e, seedLocalId: r, seedUid: t }) => {
  const [n, i] = w(), [a, o] = w(!!(r || t)), [l, c] = w(null), s = F(void 0), d = F(!1), u = z(), f = F(e), h = F(r), b = F(t), v = D(() => u ? !!(h.current || b.current) : !1, [u, r, t]), p = x(async () => {
    if (!!!(u && (h.current || b.current))) {
      i(void 0), o(!1), c(null);
      return;
    }
    try {
      c(null);
      const m = await Ne.find({
        modelName: f.current,
        seedLocalId: h.current,
        seedUid: b.current
      });
      if (!m) {
        pe("[useItem] [loadItem] no item found", f.current, h.current), i((E) => E && (E.seedLocalId && E.seedLocalId === h.current || E.seedUid && E.seedUid === b.current) ? E : void 0), o(!1), c(null);
        return;
      }
      i(m), o(!1), c(null);
    } catch (m) {
      pe("[useItem] Error loading item:", m), i(void 0), o(!1), c(m);
    }
  }, [u]);
  return I(() => {
    f.current = e, h.current = r, b.current = t;
  }, [e, r, t]), I(() => {
    if (!v) {
      !r && !t && (i(void 0), o(!1), c(null));
      return;
    }
    p();
  }, [v, p, r, t]), I(() => {
    if (!n) {
      s.current?.unsubscribe(), s.current = void 0, d.current = !1;
      return;
    }
    s.current?.unsubscribe(), d.current = !1;
    const m = n.getService().subscribe((E) => {
      E && typeof E == "object" && "value" in E && (E.value === "idle" ? (d.current = !0, o(!1), c(null)) : E.value === "error" ? (c(new Error("Item service error")), o(!1)) : d.current && o(!0));
    });
    return s.current = m, () => {
      s.current?.unsubscribe(), s.current = void 0;
    };
  }, [n]), {
    item: n,
    isLoading: a,
    error: l
  };
}, at = (e, r, t, n) => ["seed", "items", e ?? null, r ?? !1, t ?? !1, n ?? null], Wt = ({
  modelName: e,
  deleted: r = !1,
  includeEas: t = !1,
  addressFilter: n
}) => {
  const i = z(), a = X(), o = F(void 0), l = F([]), c = F(/* @__PURE__ */ new Set()), [s, d] = w(null);
  I(() => {
    if (n !== "owned" && n !== "watched") {
      d(null);
      return;
    }
    let m = !1;
    return Ke(n).then((E) => {
      m || d(E);
    }), () => {
      m = !0;
    };
  }, [n]);
  const u = D(
    () => at(e, r, t, n),
    [e, r, t, n]
  ), {
    data: f = [],
    isLoading: h,
    error: b
  } = Z({
    queryKey: u,
    queryFn: () => Ne.all(e, r, { waitForReady: !0, includeEas: t, addressFilter: n }),
    enabled: i
  });
  l.current = f;
  const v = i ? W.getAppDb() : null, p = D(() => {
    if (!v || (n === "owned" || n === "watched") && s === null)
      return null;
    const m = [];
    t || m.push(te(le(A.uid), O(A.uid, ""))), e && m.push(O(A.type, nt(e))), n === "owned" ? s && s.length > 0 && m.push(
      te(
        De(A.publisher, s),
        le(A.publisher)
      )
    ) : n === "watched" && (s && s.length > 0 ? m.push(De(A.publisher, s)) : m.push(et`1=0`)), r ? m.push(
      te(
        Ie(A._markedForDeletion),
        O(A._markedForDeletion, 1)
      )
    ) : (m.push(
      te(
        le(A._markedForDeletion),
        O(A._markedForDeletion, 0)
      )
    ), m.push(
      te(le(A.revokedAt), O(A.revokedAt, 0))
    ));
    const E = je();
    return v.with(E).select({
      localId: A.localId,
      uid: A.uid,
      type: A.type,
      schemaUid: A.schemaUid,
      createdAt: A.createdAt,
      attestationCreatedAt: A.attestationCreatedAt,
      _markedForDeletion: A._markedForDeletion
    }).from(A).leftJoin(E, O(A.localId, E.seedLocalId)).where(Ee(tt(E.versionsCount, 0), ...m)).groupBy(A.localId);
  }, [v, i, e, r, t, n, s]), y = ie(p);
  return I(() => {
    if (!i || !y) return;
    const m = /* @__PURE__ */ new Set();
    for (const R of y) {
      const N = R.localId || R.uid;
      N && m.add(N);
    }
    const E = /* @__PURE__ */ new Set();
    for (const R of l.current) {
      const N = R.seedLocalId || R.seedUid;
      N && E.add(N);
    }
    if (m.size === 0 && E.size > 0) return;
    const g = c.current;
    if (g.size === m.size && [...g].every((R) => m.has(R)))
      return;
    if (o.current = y, E.size === m.size && [...E].every((R) => m.has(R))) {
      c.current = new Set(m);
      return;
    }
    c.current = new Set(m), a.invalidateQueries({ queryKey: u });
  }, [i, y, a, u]), {
    items: Ze(
      f,
      [
        (m) => m.lastVersionPublishedAt || m.attestationCreatedAt || m.createdAt
      ],
      ["desc"]
    ),
    isLoading: h,
    error: b
  };
}, Gt = () => {
  const [e, r] = w(!1), [t, n] = w(null), i = x(() => n(null), []);
  return {
    createItem: x(
      async (o, l) => {
        if (e) {
          pe("[useCreateItem] [createItem] already creating item, skipping");
          return;
        }
        n(null), de(() => r(!0));
        try {
          const c = l ?? {}, { seedLocalId: s } = await We({ modelName: o, ...c });
          return await Ne.find({ modelName: o, seedLocalId: s }) ?? void 0;
        } catch (c) {
          pe("[useCreateItem] Error creating item:", c), n(c instanceof Error ? c : new Error(String(c)));
          return;
        } finally {
          queueMicrotask(() => r(!1));
        }
      },
      [e]
    ),
    isLoading: e,
    error: t,
    resetError: i
  };
}, Jt = () => {
  const [e, r] = w(null), [t, n] = w(!1), [i, a] = w(null), o = F(void 0), l = x(() => a(null), []), c = x((s) => {
    s && (r(s), a(null), s.publish().catch(() => {
    }));
  }, []);
  return I(() => {
    if (!e) {
      o.current?.unsubscribe(), o.current = void 0, n(!1);
      return;
    }
    o.current?.unsubscribe();
    const s = e.getService(), d = s.subscribe((b) => {
      const v = b?.value, p = b?.context;
      n(v === "publishing");
      const y = p?._publishError;
      a(y ? new Error(y.message) : null);
    });
    o.current = d;
    const u = s.getSnapshot();
    n(u?.value === "publishing");
    const h = u?.context?._publishError;
    return a(h ? new Error(h.message) : null), () => {
      o.current?.unsubscribe(), o.current = void 0;
    };
  }, [e]), {
    publishItem: c,
    isLoading: t,
    error: i,
    resetError: l
  };
}, ye = J("seedSdk:react:property"), ne = J("seedSdk:react:itemProperties");
function Ue(e, r) {
  const t = z(), [n, i] = w(void 0), [a, o] = w(!1), [l, c] = w(null), s = F(void 0), [, d] = w(0), f = typeof e == "object" && e != null ? e : null, h = f?.itemId, b = f?.seedLocalId, v = f?.seedUid, p = f?.propertyName, y = typeof e == "string" ? e : h !== void 0 && h !== "" ? h : void 0, E = p ?? (typeof e == "string" ? r : void 0), g = D(() => {
    const N = y !== void 0 && y !== "" ? y : b, H = y !== void 0 && y !== "" ? void 0 : v;
    return (N != null || H != null) && E != null && E !== "" ? {
      type: "identifiers",
      seedLocalId: N ?? void 0,
      seedUid: H,
      propertyName: E
    } : null;
  }, [y, E, b, v]);
  D(() => g ? !!((g.seedLocalId || g.seedUid) && g.propertyName) : !1, [g]);
  const B = D(() => !t || !g ? !1 : !!((g.seedLocalId || g.seedUid) && g.propertyName), [t, g]);
  Ve(() => {
    B && o(!0);
  }, [B]);
  const R = x(async () => {
    if (!t || !g) {
      i(void 0), o(!1), c(null);
      return;
    }
    try {
      o(!0), c(null);
      const N = g.seedLocalId, H = g.seedUid;
      if (!N && !H) {
        i(void 0), o(!1), c(null);
        return;
      }
      const Q = await se.find({
        propertyName: g.propertyName,
        seedLocalId: N,
        seedUid: H
      });
      if (!Q) {
        ye(
          `[useItemProperty] [updateItemProperty] no property found for Item.${N || H}.${g.propertyName}`
        ), i(void 0), o(!1), c(null);
        return;
      }
      i(Q), o(!1), c(null);
    } catch (N) {
      ye("[useItemProperty] Error updating item property:", N), i(void 0), o(!1), c(N);
    }
  }, [t, g]);
  return I(() => {
    if (!B) {
      i(void 0), o(!1), c(null);
      return;
    }
    n && g && n.propertyName === g.propertyName && (g.seedLocalId != null && n.seedLocalId === g.seedLocalId || g.seedUid != null && n.seedUid === g.seedUid) || R();
  }, [B, R, n, g]), I(() => {
    if (!n) {
      s.current?.unsubscribe(), s.current = void 0;
      return;
    }
    s.current?.unsubscribe();
    let N = 0, H = !1, Q;
    const L = 50, k = n.getService().subscribe((_) => {
      if (_ && typeof _ == "object" && "value" in _ && _.value === "idle") {
        o(!1), c(null);
        const M = _.context, G = JSON.stringify([M.renderValue, M.propertyValue]);
        (!H || G !== Q) && (H = !0, Q = G, d((re) => re + 1));
        return;
      }
      H = !1, Q = void 0;
      const V = Date.now();
      V - N >= L && (N = V, d((M) => M + 1));
    });
    return s.current = k, () => {
      s.current?.unsubscribe(), s.current = void 0;
    };
  }, [n]), {
    property: n,
    isLoading: a,
    error: l
  };
}
function Yt(e, r = 300) {
  const t = "itemId" in e ? e.itemId : void 0, n = "seedLocalId" in e ? e.seedLocalId : void 0, i = "seedUid" in e ? e.seedUid : void 0, a = e.propertyName, o = D(() => t ? { seedLocalId: t, propertyName: a } : { seedLocalId: n, seedUid: i, propertyName: a }, [t, n, i, a]), { property: l, isLoading: c, error: s } = Ue(o), d = F(""), u = D(
    () => $e((h) => {
      h.getService().send({
        type: "save",
        newValue: d.current
      });
    }, r),
    [r]
  );
  I(() => () => u.cancel(), [u]);
  const f = x(
    (h) => {
      l && (d.current = h, l.getService().send({
        type: "updateContext",
        propertyValue: h,
        renderValue: h
      }), u(l));
    },
    [l, u]
  );
  return {
    property: l,
    setValue: f,
    isLoading: c,
    error: s
  };
}
async function lt(e, r) {
  if (!e && !r) return [];
  const t = W.getAppDb();
  if (!t) return [];
  const n = await se.all(
    { seedLocalId: e ?? void 0, seedUid: r ?? void 0 },
    { waitForReady: !0 }
  ), i = [...n], a = /* @__PURE__ */ new Set();
  for (const c of n)
    c.propertyName && a.add(c.propertyName);
  let o;
  if (n.length > 0) {
    const c = n[0];
    o = c.modelName ?? c.modelType, o && typeof o == "string" && (o = _e(o));
  }
  if (!o) {
    const c = await t.select({ type: A.type }).from(A).where(r ? O(A.uid, r) : O(A.localId, e)).limit(1);
    c.length > 0 && c[0].type && (o = _e(c[0].type));
  }
  const l = [];
  if (o)
    try {
      const { Model: c } = await import("@seedprotocol/sdk"), s = await c.getByNameAsync(o);
      if (s?.properties)
        for (const d of s.properties)
          d.name && l.push(d.name);
    } catch (c) {
      ne(`[useItemProperties] Error getting ModelProperties for ${o}:`, c);
    }
  if (o && l.length > 0) {
    const c = n.length > 0 ? n[0].seedLocalId ?? e : e, s = n.length > 0 ? n[0].seedUid ?? r : r;
    for (const d of l)
      if (!a.has(d))
        try {
          const u = se.create(
            {
              propertyName: d,
              modelName: o,
              seedLocalId: c || void 0,
              seedUid: s || void 0,
              propertyValue: null
            },
            { waitForReady: !1 }
          );
          u && i.push(u);
        } catch (u) {
          ye(`[useItemProperties] Error creating ItemProperty for missing property ${d}:`, u);
        }
  }
  if (e || r) {
    const c = await t.select({ createdAt: A.createdAt }).from(A).where(r ? O(A.uid, r) : O(A.localId, e)).limit(1);
    if (c.length > 0 && c[0].createdAt) {
      const s = "createdAt";
      if (!i.some((u) => u.propertyName === s) && o)
        try {
          const u = n.length > 0 ? n[0].seedLocalId ?? e : e, f = n.length > 0 ? n[0].seedUid ?? r : r, h = se.create(
            {
              propertyName: s,
              modelName: o,
              seedLocalId: u || void 0,
              seedUid: f || void 0,
              propertyValue: c[0].createdAt.toString()
            },
            { waitForReady: !1 }
          );
          h && i.push(h);
        } catch (u) {
          ye("[useItemProperties] Error creating createdAt ItemProperty:", u);
        }
    }
  }
  return i;
}
function Xt(e) {
  const r = z(), t = X(), n = F(void 0), i = D(() => typeof e == "string" ? { type: "itemId", itemId: e } : typeof e == "object" ? {
    type: "identifiers",
    seedLocalId: e.seedLocalId,
    seedUid: e.seedUid
  } : null, [e]), a = D(() => {
    if (i)
      return i.type === "itemId" ? i.itemId : i.seedLocalId;
  }, [i]), o = D(() => {
    if (!(!i || i.type === "itemId"))
      return i.seedUid;
  }, [i]), l = a ?? o ?? "", c = D(
    () => ["seed", "itemProperties", l],
    [l]
  ), {
    data: s = [],
    isLoading: d,
    error: u
  } = Z({
    queryKey: c,
    queryFn: () => lt(a, o),
    enabled: r && !!l
  }), f = D(() => {
    if (!r || !a && !o)
      return ne("[useItemProperties] Query: returning null (not ready or no identifiers)"), null;
    const v = W.getAppDb();
    if (!v)
      return ne("[useItemProperties] Query: returning null (no db)"), null;
    ne(`[useItemProperties] Query: creating query for seedLocalId=${a}, seedUid=${o}`);
    const p = o ? v.select({
      propertyName: T.propertyName,
      propertyValue: T.propertyValue,
      seedLocalId: T.seedLocalId,
      seedUid: T.seedUid,
      modelType: T.modelType,
      schemaUid: T.schemaUid,
      createdAt: T.createdAt,
      attestationCreatedAt: T.attestationCreatedAt
    }).from(T).where(
      Ee(
        O(T.seedUid, o),
        Ie(T.propertyName)
      )
    ) : a ? v.select({
      propertyName: T.propertyName,
      propertyValue: T.propertyValue,
      seedLocalId: T.seedLocalId,
      seedUid: T.seedUid,
      modelType: T.modelType,
      schemaUid: T.schemaUid,
      createdAt: T.createdAt,
      attestationCreatedAt: T.attestationCreatedAt
    }).from(T).where(
      Ee(
        O(T.seedLocalId, a),
        Ie(T.propertyName)
      )
    ) : null;
    return ne("[useItemProperties] Query: created query object", { queryType: o ? "seedUid" : "seedLocalId" }), p;
  }, [r, a, o]), h = ie(f), b = D(() => {
    if (!h || h.length === 0)
      return [];
    const v = /* @__PURE__ */ new Map();
    for (const p of h) {
      if (!p.propertyName) continue;
      const y = v.get(p.propertyName);
      if (!y)
        v.set(p.propertyName, p);
      else {
        const m = y.attestationCreatedAt || y.createdAt || 0;
        (p.attestationCreatedAt || p.createdAt || 0) > m && v.set(p.propertyName, p);
      }
    }
    return Array.from(v.values());
  }, [h]);
  return I(() => {
    if (!r || !a && !o || b === void 0) return;
    const v = JSON.stringify(
      b.map((p) => ({
        propertyName: p.propertyName,
        propertyValue: p.propertyValue,
        seedLocalId: p.seedLocalId,
        seedUid: p.seedUid
      })).sort((p, y) => (p.propertyName || "").localeCompare(y.propertyName || ""))
    );
    n.current !== v && (n.current = v, b.length > 0 && t.invalidateQueries({ queryKey: c }));
  }, [r, b, s, a, o, t, c]), I(() => {
    n.current = void 0;
  }, [a, o]), {
    properties: s,
    isLoading: d,
    error: u
  };
}
const Zt = () => {
  const e = F(void 0), [r, t] = w(!1), [n, i] = w(null), a = x(() => i(null), []), o = x((l) => {
    if (!l.propertyName || !l.seedLocalId && !l.seedUid || !l.modelName) {
      const d = new Error("seedLocalId or seedUid, propertyName, and modelName are required");
      i(d);
      return;
    }
    i(null), t(!0), e.current?.unsubscribe(), e.current = void 0;
    const c = se.create(l, { waitForReady: !1 });
    if (!c) {
      i(new Error("Failed to create item property")), t(!1);
      return;
    }
    const s = c.getService().subscribe((d) => {
      if (d?.value === "error") {
        const u = d.context?._loadingError?.error ?? new Error("Failed to create item property");
        i(u instanceof Error ? u : new Error(String(u))), t(!1);
      }
      d?.value === "idle" && (i(null), t(!1));
    });
    return e.current = s, c;
  }, []);
  return I(() => () => {
    e.current?.unsubscribe(), e.current = void 0;
  }, []), {
    create: o,
    isLoading: r,
    error: n,
    resetError: a
  };
}, er = () => {
  const [e, r] = w(null), [t, n] = w({
    isLoading: !1,
    error: null
  });
  I(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const o = e.getService(), l = () => {
      const d = o.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    l();
    const c = o.subscribe(l);
    return () => c.unsubscribe();
  }, [e]);
  const i = x(async (o) => {
    o && (r(o), await o.destroy());
  }, []), a = x(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: i,
    isLoading: t.isLoading,
    error: t.error,
    resetError: a
  };
}, Le = J("seedSdk:react:services"), ct = ["idle", "ready", "done", "success", "initialized"], Oe = (e) => {
  let r = "actor";
  const t = e;
  return e && t.uniqueKey && (r = t.uniqueKey), e && !t.uniqueKey && t.logic && t.logic.config && (r = Ae(e)), r;
}, Fe = (e) => {
  let r;
  return e && e.getSnapshot() && e.getSnapshot().value && (r = e.getSnapshot().value), Oe(e) === "global" && r && typeof r == "object" && Object.keys(r).length > 0 && Object.keys(r)[0] === "initialized" && (r = "ready"), r && typeof r == "object" && (r = JSON.stringify(r)), r;
}, Ae = (e) => {
  const r = e;
  if (!e || !r.logic || !r.logic.config || !r._snapshot)
    return;
  const t = r.logic.config;
  if (!t.id)
    return;
  let n = t.id;
  t.id.includes("@seedSdk/") && (n = t.id.match(/^.*@seedSdk\/(\w+)[\.\w]*/)[1]);
  let i;
  try {
    i = e.getSnapshot();
  } catch (a) {
    return Le("Error:", a), n;
  }
  if (i) {
    const a = i.context;
    a && a.dbName && (n = a.dbName), a && a.modelNamePlural && (n = a.modelNamePlural), a && a.modelName && (n = it(a.modelName.toLowerCase()));
  }
  return n;
}, tr = (e) => {
  const [r, t] = w(0), n = (o) => {
    let l = 0;
    const c = o;
    if (c.logic?.states) {
      const s = [], d = [];
      for (const [h, b] of Object.entries(c.logic.states))
        b.tags?.includes("loading") && (s.push(h), d.push(b));
      const u = d.length, f = Fe(o);
      if (f && ct.includes(f))
        return 0;
      f && (l = s.indexOf(f) / u * 100);
    }
    return l;
  }, i = x(
    (o) => {
      e.getSnapshot().context;
      const l = e.getSnapshot().value;
      if (l === "done" || l === "success" || l === "idle" || l === "ready") {
        clearInterval(o);
        return;
      }
      t((c) => c + 1);
    },
    [e]
  ), a = x(() => {
    const o = setInterval(() => {
      i(o);
    }, 1e3);
    return o;
  }, [i, e]);
  return I(() => {
    const o = a();
    return () => clearInterval(o);
  }, []), {
    name: Oe(e),
    timeElapsed: r,
    value: Fe(e),
    percentComplete: n(e),
    uniqueKey: Ae(e)
  };
}, dt = () => {
  const [e, r] = w(!1), { internalStatus: t } = pt();
  return I(() => {
    t === "ready" && r(!0);
  }, [t]), I(() => {
    t === "ready" && r(!0);
  }, []), e;
}, rr = () => {
  const [e, r] = w(!1), t = ut(), { services: n, percentComplete: i } = ft(), a = x(async () => {
    for (const l of n) {
      const c = Ae(l);
      Le(
        `would save to db with snapshot__${c}:`,
        JSON.stringify(l.getPersistedSnapshot())
      );
    }
  }, [n]), o = x(async () => {
    const l = W.getAppDb();
    return l ? await l.select().from(ue).where(Be(ue.key, "snapshot__%")) : [];
  }, []);
  I(() => !t || e ? void 0 : ((async () => {
    const c = await o();
    Le("persistedSnapshots:", c), r(!0);
  })(), () => {
    a();
  }), [t, e]);
}, ut = () => {
  const [e, r] = w(!1), t = dt();
  return I(() => {
    t && (async () => {
      const a = await W.getAppDb().select().from(ue).where(Be(ue.key, "snapshot__%"));
      a && a.length > 0 && r(!0);
    })();
  }, [t]), e;
}, ft = () => {
  const [e, r] = w([]), [t, n] = w(5);
  return I(() => {
    const a = me().getService(), o = a;
    o.uniqueKey = "clientManager", r([o]);
    const l = a.subscribe((c) => {
      const s = c.value;
      let d = 0;
      s === C.IDLE ? d = 100 : s === C.ADD_MODELS_TO_DB ? d = 90 : s === C.ADD_MODELS_TO_STORE ? d = 80 : s === C.PROCESS_SCHEMA_FILES ? d = 70 : s === C.SAVE_CONFIG ? d = 60 : s === C.DB_INIT ? d = 50 : s === C.FILE_SYSTEM_INIT ? d = 30 : s === C.PLATFORM_CLASSES_INIT && (d = 10), n(d);
    });
    return () => {
      l.unsubscribe();
    };
  }, []), {
    services: e,
    percentComplete: t
  };
}, pt = () => {
  const r = me().getService(), t = we(r, (i) => i.value), n = we(r, (i) => {
    const a = i.value;
    return a === C.DB_INIT || a === C.SAVE_CONFIG || a === C.PROCESS_SCHEMA_FILES || a === C.ADD_MODELS_TO_STORE || a === C.ADD_MODELS_TO_DB || a === C.IDLE ? "ready" : a;
  });
  return {
    status: t,
    internalStatus: n
  };
};
J("seedSdk:react:db");
const nr = () => {
  const [e, r] = w(!1), t = x(() => {
    e || r(!0);
  }, []);
  return I(() => {
    let n;
    return (async () => {
      const o = me().getService(), l = o.getSnapshot().value;
      if (l === C.DB_INIT || l === C.SAVE_CONFIG || l === C.PROCESS_SCHEMA_FILES || l === C.ADD_MODELS_TO_STORE || l === C.ADD_MODELS_TO_DB || l === C.IDLE) {
        t();
        return;
      }
      n = o.subscribe((c) => {
        const s = c.value;
        (s === C.DB_INIT || s === C.SAVE_CONFIG || s === C.PROCESS_SCHEMA_FILES || s === C.ADD_MODELS_TO_STORE || s === C.ADD_MODELS_TO_DB || s === C.IDLE) && (t(), n?.unsubscribe());
      });
    })(), () => {
      n && n.unsubscribe();
    };
  }, []), {
    dbsAreReady: e
  };
}, qe = J("seedSdk:react:schema"), yt = (e) => {
  const [r, t] = w(null), [n, i] = w(!!e), [a, o] = w(null), l = F(null), c = z(), s = x((d) => {
    i(!0), o(null);
    try {
      const u = he.create(d, {
        waitForReady: !1
      });
      t(u);
      const f = u.getService();
      f.getSnapshot().value === "idle" ? (de(() => i(!1)), o(null)) : i(!0), l.current = f.subscribe((v) => {
        v.value === "idle" ? (de(() => i(!1)), o(null)) : i(!0);
      });
    } catch (u) {
      return qe("[useSchema] Error creating schema:", u), o(u), t(null), i(!1), null;
    }
  }, []);
  return I(() => {
    if (l.current && (l.current.unsubscribe(), l.current = null), !c) {
      t(null), o(null), i(!1);
      return;
    }
    if (!e) {
      t(null), o(null), i(!1);
      return;
    }
    return s(e), () => {
      l.current && (l.current.unsubscribe(), l.current = null);
    };
  }, [e, c, s]), {
    schema: r,
    isLoading: n,
    error: a
  };
}, be = ["seed", "schemas"], sr = () => {
  const e = z(), r = X(), t = F(void 0), n = F([]), {
    data: i = [],
    isLoading: a,
    error: o
  } = Z({
    queryKey: be,
    queryFn: () => he.all({ waitForReady: !0 }),
    enabled: e
  });
  n.current = i;
  const l = e ? W.getAppDb() : null, c = D(() => l ? l.select().from(Y).orderBy(Y.name, rt(Y.version)) : null, [l, e]), s = ie(c);
  return I(() => {
    if (typeof BroadcastChannel > "u") return;
    const d = new BroadcastChannel("seed-schemas-invalidate"), u = () => {
      r.invalidateQueries({ queryKey: be });
    };
    return d.addEventListener("message", u), () => {
      d.removeEventListener("message", u), d.close();
    };
  }, [r]), I(() => {
    if (!e || !s)
      return;
    const d = t.current, u = d ? JSON.stringify(d) : "undefined", f = s ? JSON.stringify(s) : "undefined";
    if (u === f && d !== void 0)
      return;
    t.current = s;
    const h = /* @__PURE__ */ new Set();
    for (const y of n.current) {
      const m = y.id || y.schemaFileId;
      if (m)
        h.add(m);
      else {
        const E = y.metadata?.name, g = y.version;
        E && g !== void 0 && h.add(`${E}:${g}`);
      }
    }
    const b = /* @__PURE__ */ new Set();
    for (const y of s)
      y.name !== "Seed Protocol" && (y.schemaFileId ? b.add(y.schemaFileId) : y.name != null && y.version !== void 0 && b.add(`${y.name}:${y.version}`));
    const v = h.size === b.size && [...h].every((y) => b.has(y)), p = h.size > 0 && b.size > 0 && [...b].some((y) => !h.has(y));
    !v && p && r.invalidateQueries({ queryKey: be });
  }, [e, s, r]), {
    schemas: i,
    isLoading: a,
    error: o
  };
}, or = () => {
  const e = F(null), [r, t] = w(!1), [n, i] = w(null), a = x(() => i(null), []), o = x((l) => {
    i(null), t(!0), e.current?.unsubscribe(), e.current = null;
    const c = he.create(l, {
      waitForReady: !1
    }), s = c.getService().subscribe((d) => {
      if (d.value === "error") {
        const u = d.context._loadingError?.error;
        i(u instanceof Error ? u : new Error("Failed to create schema")), t(!1);
      }
      d.value === "idle" && (i(null), t(!1));
    });
    return e.current = s, c;
  }, []);
  return I(() => () => {
    e.current?.unsubscribe(), e.current = null;
  }, []), {
    createSchema: o,
    isLoading: r,
    error: n,
    resetError: a
  };
}, ir = () => {
  const [e, r] = w(null), [t, n] = w({
    isLoading: !1,
    error: null
  });
  I(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const o = e.getService(), l = () => {
      const d = o.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    l();
    const c = o.subscribe(l);
    return () => c.unsubscribe();
  }, [e]);
  const i = x(async (o) => {
    o && (r(o), await o.destroy());
  }, []), a = x(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: i,
    isLoading: t.isLoading,
    error: t.error,
    resetError: a
  };
}, ar = () => {
  const [e, r] = w(), t = F(/* @__PURE__ */ new Map()), n = z(), i = x(async () => {
    if (n)
      try {
        const a = await Ge(), o = /* @__PURE__ */ new Set();
        for (const c of a) {
          const s = c.schema.metadata?.name;
          s && o.add(s);
        }
        const l = /* @__PURE__ */ new Map();
        for (const c of o)
          if (t.current.has(c)) {
            const s = t.current.get(c);
            l.set(c, s);
          } else {
            const s = he.create(c, {
              waitForReady: !1
            });
            l.set(c, s);
          }
        for (const [c, s] of t.current.entries())
          o.has(c) || s.unload();
        t.current = l, r(Array.from(l.values()));
      } catch (a) {
        qe("Error fetching all schema versions from database:", a), r(null);
      }
  }, [n]);
  return I(() => {
    n && i();
  }, [n, i]), I(() => () => {
    t.current.forEach((a) => {
      a.unload();
    }), t.current.clear();
  }, []), e;
}, lr = () => yt(Je), mt = (e) => ["seed", "models", e], Ce = /* @__PURE__ */ new Map(), ht = (e) => {
  const r = z(), t = X(), n = F([]), i = D(() => mt(e), [e]), {
    data: a = [],
    isLoading: o,
    error: l
  } = Z({
    queryKey: i,
    queryFn: async () => {
      const p = t.getQueryData(i), y = await oe.all(e, { waitForReady: !1 });
      if (Array.isArray(p) && p.length > 0 && Array.isArray(y) && y.length === 0)
        return [...p];
      if (Array.isArray(y) && y.length === 0) {
        const m = t.getQueryData(i);
        if (Array.isArray(m) && m.length > 0)
          return [...m];
      }
      return y;
    },
    enabled: r && !!e
  }), c = e && typeof e == "string" ? e : "";
  a.length > 0 && Ce.set(c, a);
  const s = n.current.length > 0 ? n.current : Ce.get(c), d = e ? a.length > 0 ? a : s?.length ? s : a : a;
  n.current = d, I(() => {
    if (!e || typeof BroadcastChannel > "u") return;
    const p = new BroadcastChannel("seed-models-invalidate"), y = (m) => {
      const { schemaName: E, schemaFileId: g } = m.data || {};
      (e === E || e === g) && (t.invalidateQueries({ queryKey: i }), t.refetchQueries({ queryKey: i }));
    };
    return p.addEventListener("message", y), () => {
      p.removeEventListener("message", y), p.close();
    };
  }, [e, t, i]);
  const u = F(null), f = F(null);
  function h() {
    const p = W.getAppDb();
    return !p || !e ? null : p.select({
      modelFileId: ae.schemaFileId,
      modelName: ae.name
    }).from(Y).innerJoin(ge, O(Y.id, ge.schemaId)).innerJoin(ae, O(ge.modelId, ae.id)).where(
      te(
        O(Y.schemaFileId, e),
        O(Y.name, e)
      )
    );
  }
  const b = D(() => {
    if (!e || !r) return null;
    const p = { schemaId: e, ready: r }, y = u.current;
    if (y && y.schemaId === p.schemaId && y.ready === p.ready && f.current !== null)
      return f.current;
    const m = h();
    return m ? (u.current = p, f.current = m, m) : null;
  }, [e, r]), v = ie(b);
  return I(() => {
    if (!r || !v || !e) return;
    const p = /* @__PURE__ */ new Set();
    for (const g of n.current) {
      const B = g.id || g.modelFileId;
      B ? p.add(B) : g.modelName && p.add(g.modelName);
    }
    const y = /* @__PURE__ */ new Set();
    for (const g of v)
      g.modelFileId ? y.add(g.modelFileId) : g.modelName && y.add(g.modelName);
    const m = p.size === y.size && [...p].every((g) => y.has(g)), E = y.size > 0 && [...y].some((g) => !p.has(g));
    !m && E && t.invalidateQueries({ queryKey: i });
  }, [r, v, e, t, i]), {
    models: d,
    isLoading: o,
    error: l
  };
}, gt = (e, r) => {
  const t = z(), [n, i] = w(void 0), [a, o] = w(!1), [l, c] = w(null), s = F(void 0), [, d] = w(0), u = r == null;
  if (D(() => t ? u ? !!e : !!(e && r) : !1, [t, u, e, r]), I(() => {
    if (!t || !u || !e) {
      i(void 0), o(!1), c(null);
      return;
    }
    (async () => {
      try {
        o(!0), c(null);
        const y = await oe.createById(e);
        i(y || void 0), o(!1), c(null);
      } catch (y) {
        console.error("[useModel] Error looking up model by ID:", y), i(void 0), o(!1), c(y);
      }
    })();
  }, [t, u, e]), I(() => {
    if (!u || !n) {
      s.current?.unsubscribe(), s.current = void 0;
      return;
    }
    s.current?.unsubscribe();
    const p = n.getService().subscribe((y) => {
      d((m) => m + 1);
    });
    return s.current = p, () => {
      s.current?.unsubscribe(), s.current = void 0;
    };
  }, [u, n]), u)
    return {
      model: n,
      isLoading: a,
      error: l
    };
  const { models: f, isLoading: h, error: b } = ht(e), v = D(() => {
    if (r)
      return f.find((p) => (p.modelName ?? p.name) === r);
  }, [f, r]);
  return I(() => {
    if (u || !v) {
      s.current?.unsubscribe(), s.current = void 0;
      return;
    }
    s.current?.unsubscribe();
    const p = v.getService().subscribe((y) => {
      d((m) => m + 1);
    });
    return s.current = p, () => {
      s.current?.unsubscribe(), s.current = void 0;
    };
  }, [u, v]), {
    model: v,
    isLoading: h,
    error: b
  };
}, cr = () => {
  const e = F(void 0), [r, t] = w(!1), [n, i] = w(null), a = x(() => i(null), []), o = x(
    (l, c, s) => {
      i(null), t(!0), e.current?.unsubscribe(), e.current = void 0;
      const d = oe.create(c, l, {
        ...s,
        waitForReady: !1
      }), u = d.getService().subscribe((f) => {
        f.value === "error" && (i(
          f.context._loadingError?.error ?? new Error("Failed to create model")
        ), t(!1)), f.value === "idle" && (i(null), t(!1));
      });
      return e.current = u, d;
    },
    []
  );
  return I(() => () => {
    e.current?.unsubscribe(), e.current = void 0;
  }, []), {
    create: o,
    isLoading: r,
    error: n,
    resetError: a
  };
}, dr = () => {
  const [e, r] = w(null), [t, n] = w({
    isLoading: !1,
    error: null
  });
  I(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const o = e.getService(), l = () => {
      const d = o.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    l();
    const c = o.subscribe(l);
    return () => c.unsubscribe();
  }, [e]);
  const i = x(async (o) => {
    o && (r(o), await o.destroy());
  }, []), a = x(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: i,
    isLoading: t.isLoading,
    error: t.error,
    resetError: a
  };
};
J("seedSdk:browser:react:modelProperty");
const ur = (e, r) => {
  const { model: t } = gt(e, r);
  D(() => {
    if (t)
      try {
        return t.modelName ?? t.name;
      } catch {
        return;
      }
  }, [t]);
  const n = z(), i = X(), a = D(() => {
    if (!t) return null;
    try {
      return t._getSnapshotContext()._dbId;
    } catch {
      return null;
    }
  }, [t]), o = t?.id, l = D(
    () => ["seed", "modelProperties", o ?? ""],
    [o]
  ), {
    data: c = [],
    isLoading: s,
    error: d
  } = Z({
    queryKey: l,
    queryFn: () => fe.all(o, { waitForReady: !0 }),
    enabled: n && !!o
  }), u = n ? W.getAppDb() : null, f = D(() => !u || !a ? null : u.select({
    id: ee.id,
    name: ee.name,
    dataType: ee.dataType,
    schemaFileId: ee.schemaFileId
  }).from(ee).where(O(ee.modelId, a)), [u, n, a]), h = ie(f), b = F([]);
  b.current = c, I(() => {
    if (!o || c.length > 0 || !i || !l) return;
    const y = [400, 1200, 2500].map(
      (m) => setTimeout(() => {
        i.invalidateQueries({ queryKey: l });
      }, m)
    );
    return () => y.forEach((m) => clearTimeout(m));
  }, [o, c.length, i, l]), I(() => {
    if (!n || !t?.id || !h || !l) return;
    const p = /* @__PURE__ */ new Set();
    for (const g of b.current) {
      const R = g._getSnapshotContext()?.id;
      R ? p.add(R) : g.name && p.add(g.name);
    }
    const y = /* @__PURE__ */ new Set();
    for (const g of h)
      g.schemaFileId ? y.add(g.schemaFileId) : g.name && y.add(g.name);
    !(p.size === y.size && (p.size === 0 || [...p].every((g) => y.has(g)))) && (p.size > 0 || y.size > 0) && i.invalidateQueries({ queryKey: l });
  }, [n, h, t?.id, i, l]);
  const v = s && c.length === 0;
  return {
    modelProperties: c,
    isLoading: v,
    error: d
  };
}, bt = async (e, r) => {
  const t = await oe.createById(e);
  if (!t)
    return;
  const n = t.modelName ?? t.name;
  if (n)
    return ke(n, r);
};
function fr(e, r, t) {
  const n = D(() => t != null ? !!(e && r && t) : r != null ? !!(e && r) : !!e, [e, r, t]), [i, a] = w(void 0), [o, l] = w(n), [c, s] = w(null), d = F(void 0), u = z(), f = D(() => t != null ? { type: "schemaId", schemaId: e, modelName: r, propertyName: t } : r != null ? { type: "modelFileId", modelFileId: e, propertyName: r } : { type: "propertyFileId", propertyFileId: e }, [e, r, t]), h = D(() => u ? f.type === "propertyFileId" ? !!f.propertyFileId : f.type === "modelFileId" ? !!(f.modelFileId && f.propertyName) : !!(f.schemaId && f.modelName && f.propertyName) : !1, [u, f]), b = x(async () => {
    if (!u) {
      a(void 0), l(!1), s(null);
      return;
    }
    let p, y;
    try {
      if (l(!0), s(null), f.type === "propertyFileId") {
        if (!f.propertyFileId) {
          a(void 0), l(!1), s(null);
          return;
        }
        const m = await fe.createById(f.propertyFileId);
        m ? (a(m), l(!1), s(null)) : (a(void 0), l(!1), s(null));
        return;
      } else if (f.type === "modelFileId") {
        if (!f.modelFileId || !f.propertyName) {
          a(void 0), l(!1), s(null);
          return;
        }
        p = await bt(f.modelFileId, f.propertyName);
        const m = await oe.createById(f.modelFileId);
        y = m?.modelName ?? m?.name;
      } else {
        if (!f.schemaId || !f.modelName || !f.propertyName) {
          a(void 0), l(!1), s(null);
          return;
        }
        p = await ke(f.modelName, f.propertyName), y = f.modelName;
      }
      if (p && y) {
        const m = fe.create(
          { ...p, modelName: y },
          { waitForReady: !1 }
        ), E = m instanceof Promise ? await m : m;
        de(() => {
          a(E), l(!1), s(null);
        });
      } else
        a(void 0), l(!1), s(null);
    } catch (m) {
      console.error("[useModelProperty] Error updating model property:", m), a(void 0), l(!1), s(m);
    }
  }, [u, f.type, f.propertyFileId, f.modelFileId, f.propertyName, f.schemaId, f.modelName]);
  I(() => {
    if (!h) {
      a(void 0), l(!1), s(null);
      return;
    }
    b();
  }, [h, b]);
  const v = f.type === "propertyFileId";
  return I(() => {
    if (!i || !v)
      return;
    d.current?.unsubscribe();
    const p = $e(b, 100), y = i.getService().subscribe(() => {
      p();
    });
    return d.current = y, () => {
      p.cancel(), d.current?.unsubscribe(), d.current = void 0;
    };
  }, [i, b, v]), {
    modelProperty: i,
    isLoading: o,
    error: c
  };
}
const pr = () => {
  const e = F(void 0), [r, t] = w(!1), [n, i] = w(null), a = x(() => i(null), []), o = x(
    (l, c, s) => {
      if (i(null), t(!0), e.current?.unsubscribe(), e.current = void 0, !c || !s.name || !s.dataType) {
        const h = new Error("modelName, property name and dataType are required");
        throw i(h), t(!1), h;
      }
      const d = Ye(l) ?? l, u = fe.create(
        { ...s, modelName: c },
        { waitForReady: !1, schemaName: d }
      ), f = u.getService().subscribe((h) => {
        if (h.value === "error") {
          const b = h.context._loadingError?.error ?? new Error("Failed to create model property");
          i(b instanceof Error ? b : new Error(String(b))), t(!1);
        }
        h.value === "idle" && (i(null), t(!1));
      });
      return e.current = f, u;
    },
    []
  );
  return I(() => () => {
    e.current?.unsubscribe(), e.current = void 0;
  }, []), {
    create: o,
    isLoading: r,
    error: n,
    resetError: a
  };
}, yr = () => {
  const [e, r] = w(null), [t, n] = w({
    isLoading: !1,
    error: null
  });
  I(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const o = e.getService(), l = () => {
      const d = o.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    l();
    const c = o.subscribe(l);
    return () => c.unsubscribe();
  }, [e]);
  const i = x(async (o) => {
    o && (r(o), await o.destroy());
  }, []), a = x(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: i,
    isLoading: t.isLoading,
    error: t.error,
    resetError: a
  };
}, mr = () => {
  const [e, r] = w(null), [t, n] = w({
    isLoading: !1,
    error: null
  });
  I(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const o = e.getService(), l = () => {
      const d = o.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    l();
    const c = o.subscribe(l);
    return () => c.unsubscribe();
  }, [e]);
  const i = x(async (o) => {
    o && (r(o), await o.destroy());
  }, []), a = x(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    deleteItem: i,
    isLoading: t.isLoading,
    error: t.error,
    resetError: a
  };
}, ve = ["seed", "imageFiles"];
function hr() {
  const e = z(), r = X(), {
    data: t = [],
    isLoading: n,
    error: i,
    refetch: a
  } = Z({
    queryKey: ve,
    queryFn: () => j.listImageFiles(),
    enabled: e
  });
  return I(() => {
    const o = (c) => {
      c.includes("/images/") && r.invalidateQueries({ queryKey: ve });
    }, l = () => {
      r.invalidateQueries({ queryKey: ve });
    };
    return K.on("file-saved", o), K.on("fs.downloadAll.success", l), () => {
      K.off("file-saved", o), K.off("fs.downloadAll.success", l);
    };
  }, [r]), {
    imageFiles: t,
    isLoading: n,
    error: i instanceof Error ? i : null,
    refetch: a
  };
}
const vt = ["seed", "files"];
function gr(e = "files") {
  const r = z(), t = X(), n = D(() => [...vt, e], [e]), {
    data: i = [],
    isLoading: a,
    error: o,
    refetch: l
  } = Z({
    queryKey: n,
    queryFn: () => j.listFiles(e),
    enabled: r
  });
  return I(() => {
    const c = (d) => {
      d.includes(`/${e}/`) && t.invalidateQueries({ queryKey: n });
    }, s = () => {
      t.invalidateQueries({ queryKey: n });
    };
    return K.on("file-saved", c), K.on("fs.downloadAll.success", s), () => {
      K.off("file-saved", c), K.off("fs.downloadAll.success", s);
    };
  }, [t, e, n]), {
    files: i,
    isLoading: a,
    error: o instanceof Error ? o : null,
    refetch: l
  };
}
const St = {
  queries: {
    networkMode: "offlineFirst",
    gcTime: 1e3 * 60 * 60 * 24,
    // 24 hours
    staleTime: 1e3 * 60
    // 1 minute - list data can be slightly stale
  }
};
function ze() {
  return { ...St };
}
function wt(e) {
  const r = ze();
  return e ? {
    queries: {
      ...r.queries,
      ...e.queries ?? {}
    },
    mutations: {
      ...r.mutations ?? {},
      ...e.mutations ?? {}
    }
  } : r;
}
function It(e) {
  const r = ze(), { defaultOptions: t, ...n } = e ?? {};
  return new st({
    ...n,
    defaultOptions: t ? wt(t) : r
  });
}
let xe = null;
function br(e) {
  const r = xe?.(e);
  return typeof window < "u" && window.__SEED_INVALIDATE_ITEM_PROPERTIES__ && window.__SEED_INVALIDATE_ITEM_PROPERTIES__(e), Promise.resolve(r).then(() => {
  });
}
function Et({ queryClient: e }) {
  return I(() => {
    const r = (n) => {
      const i = ["seed", "itemProperties", n];
      return e.invalidateQueries({ queryKey: i }), e.refetchQueries({ queryKey: i });
    };
    xe = r, typeof window < "u" && (window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = r);
    const t = (n) => {
      const i = n?.seedLocalId ?? n?.seedUid;
      i && r(i);
    };
    return K.on("itemProperty.saved", t), () => {
      K.off("itemProperty.saved", t), xe = null, typeof window < "u" && (window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = null);
    };
  }, [e]), null;
}
function vr({ children: e, queryClient: r, queryClientRef: t }) {
  const n = D(
    () => r ?? It(),
    [r]
  );
  if (t && (t.current = n, typeof window < "u")) {
    const i = window;
    i.__TEST_SEED_QUERY_CLIENT__ = n;
    try {
      window.parent && window.parent !== window && (window.parent.__TEST_SEED_QUERY_CLIENT__ = n);
    } catch {
    }
  }
  return /* @__PURE__ */ U(ot, { client: n, children: [
    /* @__PURE__ */ S(Et, { queryClient: n }),
    e
  ] });
}
function Lt() {
  return /* @__PURE__ */ S(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%"
      },
      children: "Loading..."
    }
  );
}
function Sr({
  initConfig: e,
  schema: r,
  loadingComponent: t,
  wrapperClassName: n,
  loadingClassName: i,
  children: a
}) {
  const o = z();
  I(() => {
    const u = r ? {
      ...e,
      config: {
        ...e.config,
        schema: r
      }
    } : e;
    Xe.init(u);
  }, [e, r]);
  const l = t ?? /* @__PURE__ */ S(Lt, {}), c = n ? void 0 : { position: "relative", display: "flex", height: "100vh", width: "100vw" }, s = {
    display: o ? "none" : "flex",
    ...!i && {
      position: "absolute",
      inset: 0,
      zIndex: 50,
      alignItems: "center",
      justifyContent: "center"
    }
  };
  return /* @__PURE__ */ U("div", { className: n, style: c, children: [
    /* @__PURE__ */ S(
      "div",
      {
        className: i,
        style: s,
        "aria-hidden": o,
        children: l
      }
    ),
    /* @__PURE__ */ S("div", { style: {
      flex: 1,
      display: o ? "flex" : "none",
      flexDirection: "column"
    }, children: a })
  ] });
}
async function He(e, r = "") {
  const t = [];
  try {
    for await (const [n, i] of e.entries()) {
      const a = r ? `${r}/${n}` : n;
      if (i.kind === "file")
        try {
          const o = await i.getFile();
          t.push({
            name: n,
            path: a,
            size: o.size,
            type: o.type || "application/octet-stream",
            lastModified: o.lastModified
          });
        } catch (o) {
          console.warn(`Failed to read file ${a}:`, o);
        }
      else if (i.kind === "directory") {
        const o = await He(i, a);
        t.push(...o);
      }
    }
  } catch (n) {
    console.warn(`Failed to scan directory ${r}:`, n);
  }
  return t;
}
function xt(e = {}) {
  const { rootPath: r } = e, [t, n] = w([]), [i, a] = w(!0), [o, l] = w(null), c = x(async () => {
    a(!0), l(null);
    try {
      let d = await navigator.storage.getDirectory();
      if (r) {
        const f = r.split("/").filter(Boolean);
        for (const h of f)
          d = await d.getDirectoryHandle(h);
      }
      const u = await He(d, r || "");
      n(u.sort((f, h) => f.path.localeCompare(h.path)));
    } catch (s) {
      l(
        "Failed to access OPFS: " + (s instanceof Error ? s.message : String(s))
      ), console.error("OPFS access error:", s);
    } finally {
      a(!1);
    }
  }, [r]);
  return I(() => {
    c();
  }, [c]), { files: t, isLoading: i, error: o, refetch: c };
}
const Pe = () => /* @__PURE__ */ S("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 20, height: 20 }, children: /* @__PURE__ */ S("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" }) }), Nt = () => /* @__PURE__ */ S("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 48, height: 48 }, children: /* @__PURE__ */ S("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M2.25 12.75V12a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" }) }), At = () => /* @__PURE__ */ S("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 20, height: 20 }, children: /* @__PURE__ */ S("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" }) }), Re = () => /* @__PURE__ */ S("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 20, height: 20 }, children: /* @__PURE__ */ S("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" }) }), _t = () => /* @__PURE__ */ U(
  "svg",
  {
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 24 24",
    style: { width: 32, height: 32 },
    "aria-hidden": !0,
    children: [
      /* @__PURE__ */ S(
        "circle",
        {
          style: { opacity: 0.25 },
          cx: "12",
          cy: "12",
          r: "10",
          stroke: "currentColor",
          strokeWidth: "4"
        }
      ),
      /* @__PURE__ */ S(
        "path",
        {
          style: { opacity: 0.75 },
          fill: "currentColor",
          d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        }
      )
    ]
  }
);
function Dt(e) {
  if (e === 0) return "0 Bytes";
  const r = 1024, t = ["Bytes", "KB", "MB", "GB"], n = Math.floor(Math.log(e) / Math.log(r));
  return Math.round(e / Math.pow(r, n) * 100) / 100 + " " + t[n];
}
function Ft(e) {
  return new Date(e).toLocaleString();
}
async function Ct(e, r) {
  const t = e.path.split("/").filter(Boolean);
  if (t.length === 0) throw new Error("Invalid file path");
  let n = r;
  for (let l = 0; l < t.length - 1; l++)
    n = await n.getDirectoryHandle(t[l]);
  const i = t[t.length - 1];
  return await (await n.getFileHandle(i)).getFile();
}
async function Me(e, r) {
  const t = e.split("/").filter(Boolean);
  if (t.length === 0) throw new Error("Invalid file path");
  let n = r;
  for (let a = 0; a < t.length - 1; a++)
    n = await n.getDirectoryHandle(t[a]);
  const i = t[t.length - 1];
  await n.removeEntry(i);
}
const Pt = {
  light: {
    title: "text-gray-900",
    description: "text-gray-500",
    batchBar: "bg-gray-100 border-gray-200",
    batchText: "text-gray-900",
    clearButton: "text-gray-500 hover:text-gray-900",
    loadingText: "text-gray-500",
    errorBox: "bg-red-50 border-red-200",
    errorTitle: "text-red-800",
    errorText: "text-red-700",
    emptyIcon: "text-gray-400",
    emptyTitle: "text-gray-900",
    emptyText: "text-gray-500",
    tableHeader: "bg-gray-100 text-gray-900",
    tableRow: "bg-white",
    tableBorder: "border-gray-200 divide-gray-200",
    tableCell: "text-gray-900",
    tableCellMuted: "text-gray-500",
    codeBlock: "bg-gray-100 border-gray-200 text-gray-800",
    actionButton: "text-gray-500 hover:text-gray-700",
    deleteButton: "text-gray-500 hover:text-red-600"
  },
  dark: {
    title: "text-white",
    description: "text-gray-400",
    batchBar: "bg-gray-800 border-gray-700",
    batchText: "text-white",
    clearButton: "text-gray-400 hover:text-white",
    loadingText: "text-gray-400",
    errorBox: "bg-red-900/50 border-red-800",
    errorTitle: "text-red-200",
    errorText: "text-red-300",
    emptyIcon: "text-gray-500",
    emptyTitle: "text-white",
    emptyText: "text-gray-400",
    tableHeader: "bg-gray-900 text-white",
    tableRow: "bg-gray-900",
    tableBorder: "border-gray-800 divide-gray-800",
    tableCell: "text-white",
    tableCellMuted: "text-gray-400",
    codeBlock: "bg-gray-800 border-gray-700 text-gray-300",
    actionButton: "text-gray-400 hover:text-indigo-400",
    deleteButton: "text-gray-400 hover:text-red-500"
  }
}, P = {
  container: { padding: "2rem 0" },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "1rem"
  },
  title: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  description: { fontSize: "0.875rem", margin: "0.5rem 0 0 0" },
  button: "rounded-md px-3 py-2 text-sm font-semibold border-0 cursor-pointer bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
  buttonDanger: "rounded-md px-3 py-2 text-sm font-semibold border-0 cursor-pointer bg-red-600 text-white hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600",
  table: "min-w-full divide-y",
  tableHeader: "py-3.5 pl-4 pr-3 text-left text-sm font-semibold sm:pl-6",
  tableCell: "whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6",
  errorBox: "rounded-md border p-4 mt-4",
  emptyState: "text-center py-12"
};
function wr({
  rootPath: e,
  filter: r,
  onBeforeDelete: t,
  onAfterDelete: n,
  onDownload: i,
  title: a = "Files",
  description: o = "Browse and download all files stored in the Origin Private File System (OPFS).",
  theme: l = "dark",
  className: c
}) {
  const s = Pt[l], { files: d, isLoading: u, error: f, refetch: h } = xt({ rootPath: e }), b = r ? d.filter(r) : d, [v, p] = w(/* @__PURE__ */ new Set()), y = F(null), m = b.length > 0 && v.size === b.length, E = v.size > 0 && v.size < b.length, g = (L) => {
    p((k) => {
      const _ = new Set(k);
      return _.has(L) ? _.delete(L) : _.add(L), _;
    });
  }, B = () => {
    p(
      v.size === b.length ? /* @__PURE__ */ new Set() : new Set(b.map((L) => L.path))
    );
  };
  I(() => {
    p(/* @__PURE__ */ new Set());
  }, [b.length]), I(() => {
    y.current && (y.current.indeterminate = E);
  }, [E]);
  const R = async (L, k = !1) => {
    try {
      const _ = await navigator.storage.getDirectory(), q = await Ct(L, _);
      if (i)
        await i(L, q);
      else {
        const V = URL.createObjectURL(q), M = document.createElement("a");
        M.href = V, M.download = L.name, document.body.appendChild(M), M.click(), document.body.removeChild(M), URL.revokeObjectURL(V);
      }
    } catch (_) {
      const q = "Failed to download file: " + (_ instanceof Error ? _.message : String(_));
      throw k || alert(q), _;
    }
  }, N = async (L) => {
    if (!(t && !await t(L)) && confirm(`Are you sure you want to delete "${L.name}"? This action cannot be undone.`))
      try {
        const k = await navigator.storage.getDirectory();
        await Me(L.path, k), await h(), await n?.([L.path]);
      } catch (k) {
        alert("Failed to delete file: " + (k instanceof Error ? k.message : String(k)));
      }
  }, H = async () => {
    if (v.size === 0) return;
    const L = b.filter((_) => v.has(_.path)), k = [];
    for (const _ of L)
      try {
        await R(_, !0), await new Promise((q) => setTimeout(q, 100));
      } catch (q) {
        k.push(`${_.name}: ${q instanceof Error ? q.message : String(q)}`);
      }
    k.length > 0 && alert(`Some downloads failed:
${k.join(`
`)}`);
  }, Q = async () => {
    if (v.size === 0) return;
    const L = b.filter((M) => v.has(M.path)), k = L.map((M) => M.name).join(", ");
    if (!confirm(
      `Are you sure you want to delete ${v.size} file(s)?

Files: ${k}

This action cannot be undone.`
    ))
      return;
    const _ = await navigator.storage.getDirectory(), q = [], V = [];
    for (const M of L)
      if (!(t && !await t(M)))
        try {
          await Me(M.path, _), q.push(M.path);
        } catch (G) {
          V.push(`${M.name}: ${G instanceof Error ? G.message : String(G)}`);
        }
    p(/* @__PURE__ */ new Set()), await h(), q.length > 0 && await n?.(q), V.length > 0 && alert(`Some deletions failed:
${V.join(`
`)}`);
  };
  return /* @__PURE__ */ U("div", { className: c, style: P.container, children: [
    /* @__PURE__ */ S("style", { children: "@keyframes opfs-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}" }),
    /* @__PURE__ */ U("div", { style: P.header, children: [
      /* @__PURE__ */ U("div", { style: { flex: 1, minWidth: 0 }, children: [
        /* @__PURE__ */ S("h1", { style: P.title, className: s.title, children: a }),
        /* @__PURE__ */ S("p", { style: P.description, className: s.description, children: o })
      ] }),
      /* @__PURE__ */ S("button", { type: "button", onClick: h, className: P.button, children: "Refresh" })
    ] }),
    v.size > 0 && /* @__PURE__ */ U(
      "div",
      {
        className: `mt-4 flex items-center justify-between rounded-lg border px-4 py-3 ${s.batchBar}`,
        children: [
          /* @__PURE__ */ U("span", { className: `text-sm font-medium ${s.batchText}`, children: [
            v.size,
            " file",
            v.size === 1 ? "" : "s",
            " selected"
          ] }),
          /* @__PURE__ */ U("div", { className: "flex items-center gap-3", children: [
            /* @__PURE__ */ S("button", { onClick: H, className: P.button, children: /* @__PURE__ */ U("span", { className: "inline-flex items-center gap-2", children: [
              /* @__PURE__ */ S(Pe, {}),
              " Download All"
            ] }) }),
            /* @__PURE__ */ S("button", { onClick: Q, className: P.buttonDanger, children: /* @__PURE__ */ U("span", { className: "inline-flex items-center gap-2", children: [
              /* @__PURE__ */ S(Re, {}),
              " Delete All"
            ] }) }),
            /* @__PURE__ */ S(
              "button",
              {
                onClick: () => p(/* @__PURE__ */ new Set()),
                className: `text-sm cursor-pointer bg-transparent border-0 ${s.clearButton}`,
                children: "Clear selection"
              }
            )
          ] })
        ]
      }
    ),
    /* @__PURE__ */ S("div", { className: "mt-8", children: u ? /* @__PURE__ */ U("div", { className: "flex justify-center items-center py-12 gap-3", children: [
      /* @__PURE__ */ S("span", { style: { animation: "opfs-spin 1s linear infinite" }, children: /* @__PURE__ */ S(_t, {}) }),
      /* @__PURE__ */ S("span", { className: s.loadingText, children: "Loading files..." })
    ] }) : f ? /* @__PURE__ */ U("div", { className: `${P.errorBox} ${s.errorBox}`, children: [
      /* @__PURE__ */ S("h3", { className: `m-0 text-sm font-medium ${s.errorTitle}`, children: "Error" }),
      /* @__PURE__ */ S("div", { className: `mt-2 text-sm ${s.errorText}`, children: f })
    ] }) : b.length === 0 ? /* @__PURE__ */ U("div", { className: P.emptyState, children: [
      /* @__PURE__ */ S("span", { className: s.emptyIcon, children: /* @__PURE__ */ S(Nt, {}) }),
      /* @__PURE__ */ S("h3", { className: `mt-2 text-sm font-semibold ${s.emptyTitle}`, children: "No files" }),
      /* @__PURE__ */ S("p", { className: `mt-1 text-sm ${s.emptyText}`, children: "No files found in OPFS." })
    ] }) : /* @__PURE__ */ S("div", { className: "overflow-x-auto", children: /* @__PURE__ */ U("table", { className: P.table, children: [
      /* @__PURE__ */ S("thead", { children: /* @__PURE__ */ U("tr", { className: s.tableBorder, children: [
        /* @__PURE__ */ S("th", { className: `${P.tableHeader} w-10 ${s.tableHeader}`, children: /* @__PURE__ */ S(
          "input",
          {
            ref: y,
            type: "checkbox",
            checked: m,
            onChange: B,
            "aria-label": "Select all"
          }
        ) }),
        /* @__PURE__ */ S("th", { className: `${P.tableHeader} ${s.tableHeader}`, children: "Name" }),
        /* @__PURE__ */ S("th", { className: `${P.tableHeader} ${s.tableHeader}`, children: "Path" }),
        /* @__PURE__ */ S("th", { className: `${P.tableHeader} ${s.tableHeader}`, children: "Size" }),
        /* @__PURE__ */ S("th", { className: `${P.tableHeader} ${s.tableHeader}`, children: "Type" }),
        /* @__PURE__ */ S("th", { className: `${P.tableHeader} ${s.tableHeader}`, children: "Modified" }),
        /* @__PURE__ */ S(
          "th",
          {
            className: `${P.tableHeader} w-24 ${s.tableHeader}`,
            "aria-label": "Actions"
          }
        )
      ] }) }),
      /* @__PURE__ */ S("tbody", { className: `divide-y ${s.tableBorder}`, children: b.map((L) => /* @__PURE__ */ U("tr", { className: s.tableRow, children: [
        /* @__PURE__ */ S("td", { className: `${P.tableCell} ${s.tableCell}`, children: /* @__PURE__ */ S(
          "input",
          {
            type: "checkbox",
            checked: v.has(L.path),
            onChange: () => g(L.path),
            "aria-label": `Select ${L.name}`
          }
        ) }),
        /* @__PURE__ */ S("td", { className: `${P.tableCell} ${s.tableCell}`, children: /* @__PURE__ */ U("span", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ S(At, {}),
          L.name
        ] }) }),
        /* @__PURE__ */ S("td", { className: `${P.tableCell} ${s.tableCellMuted}`, children: /* @__PURE__ */ S("code", { className: `text-xs px-2 py-1 rounded border ${s.codeBlock}`, children: L.path }) }),
        /* @__PURE__ */ S("td", { className: `${P.tableCell} ${s.tableCellMuted}`, children: Dt(L.size) }),
        /* @__PURE__ */ S("td", { className: `${P.tableCell} ${s.tableCellMuted}`, children: L.type }),
        /* @__PURE__ */ S("td", { className: `${P.tableCell} ${s.tableCellMuted}`, children: Ft(L.lastModified) }),
        /* @__PURE__ */ S("td", { className: P.tableCell, children: /* @__PURE__ */ U("div", { className: "flex gap-2 justify-end", children: [
          /* @__PURE__ */ S(
            "button",
            {
              type: "button",
              onClick: () => R(L),
              title: "Download",
              className: `p-1.5 rounded cursor-pointer bg-transparent border-0 transition-colors ${s.actionButton}`,
              children: /* @__PURE__ */ S(Pe, {})
            }
          ),
          /* @__PURE__ */ S(
            "button",
            {
              type: "button",
              onClick: () => N(L),
              title: "Delete",
              className: `p-1.5 rounded cursor-pointer bg-transparent border-0 transition-colors ${s.deleteButton}`,
              children: /* @__PURE__ */ S(Re, {})
            }
          )
        ] }) })
      ] }, L.path)) })
    ] }) }) })
  ] });
}
const Se = J("seedSdk:react:SeedImage"), ce = /* @__PURE__ */ new Map(), Qe = (e) => {
  const r = /^(.*[\/\\])?([^\/\\]+?)(\.[^.\/\\]*)?$/, t = e.match(r);
  return t && t[2] ? t[2] : e;
};
function Rt(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Mt(e, r) {
  const t = new RegExp(`^${Rt(r)}$`), n = Qe(e);
  return t.test(n);
}
const Tt = ({ imageProperty: e, width: r, filename: t, ...n }) => {
  const [i, a] = w(), [o, l] = w(), { property: c } = Ue({
    propertyName: e.propertyName,
    seedLocalId: e.seedLocalId,
    seedUid: e.seedUid
  }), s = e ?? c, d = t ?? s?.refResolvedValue ?? s?.value, u = s?.value, f = typeof u == "string" ? u : d, h = u != null && (u instanceof File || u instanceof Blob), [b, v] = w(null), p = Te.useRef(null);
  I(() => {
    if (h && (u instanceof File || u instanceof Blob))
      return p.current || (p.current = URL.createObjectURL(u), v(p.current)), () => {
        p.current && (URL.revokeObjectURL(p.current), p.current = null), v(null);
      };
    p.current = null, v(null);
  }, [h, u]), I(() => {
    if (!d || u && ((N) => typeof N == "string" && N.startsWith("blob:"))(u) || b) return;
    let B = !1;
    return (async () => {
      try {
        const N = s?.localStoragePath ? s.localStoragePath : `${j.getFilesPath("images")}/${d}`;
        if (await j.pathExists(N)) {
          const Q = await j.getContentUrlFromPath(N);
          !B && Q && l(Q);
        }
      } catch (N) {
        Se("_getOriginalContentUrl error", N);
      }
    })(), () => {
      B = !0;
    };
  }, [d, u, b, s?.localStoragePath]), I(() => {
    if (!r || !d)
      return;
    (async () => {
      try {
        const B = await j.getFs(), R = s?.localStoragePath ? s.localStoragePath.split("/").slice(0, -1).join("/") : j.getFilesPath("images"), Q = B.readdirSync(R, { withFileTypes: !0 }).filter(($) => $.isDirectory()).map(($) => parseInt($.name)), L = Q.reduce(($, re) => Math.abs(re - r) < Math.abs($ - r) ? re : $, Q[0]), k = Qe(d), _ = `${k}-${L}`;
        if (ce.has(_))
          try {
            const $ = ce.get(_);
            if ($ && (await fetch($)).ok) {
              a($);
              return;
            }
          } catch ($) {
            Se("error", $), ce.delete(_);
          }
        const V = B.readdirSync(`${R}/${L}`, { withFileTypes: !0 }).find(($) => $.name ? Mt($.name, k) : !1);
        if (!V)
          return;
        const M = `${R}/${L}/${V?.name}`;
        if (await j.pathExists(M)) {
          const $ = await j.getContentUrlFromPath(M);
          $ && (ce.set(_, $), a($));
        }
      } catch (B) {
        Se("_getSizedContentUrl error", B);
      }
    })();
  }, [s, r, f, d]);
  const y = (g) => typeof g == "string" && g.startsWith("blob:");
  if (!(!!i || !!o || !!b || !!f && y(f)) && !d)
    return null;
  const E = i || o || b || (y(f) ? f : void 0) || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  return /* @__PURE__ */ S("img", { src: E, alt: n.alt || e.propertyName || "Image", ...n });
}, Ir = Te.memo(
  Tt,
  (e, r) => e.imageProperty === r.imageProperty && e.width === r.width && e.filename === r.filename
);
export {
  vt as FILES_QUERY_KEY_PREFIX,
  wr as OPFSFilesManager,
  Sr as SeedClientGate,
  Ir as SeedImage,
  vr as SeedProvider,
  It as createSeedQueryClient,
  ze as getSeedQueryDefaultOptions,
  Oe as getServiceName,
  Ae as getServiceUniqueKey,
  Fe as getServiceValue,
  br as invalidateItemPropertiesForItem,
  wt as mergeSeedQueryDefaults,
  ar as useAllSchemaVersions,
  Gt as useCreateItem,
  Zt as useCreateItemProperty,
  cr as useCreateModel,
  pr as useCreateModelProperty,
  or as useCreateSchema,
  nr as useDbsAreReady,
  Yt as useDebouncedItemProperty,
  mr as useDeleteItem,
  er as useDestroyItemProperty,
  dr as useDestroyModel,
  yr as useDestroyModelProperty,
  ir as useDestroySchema,
  gr as useFiles,
  pt as useGlobalServiceStatus,
  ut as useHasSavedSnapshots,
  hr as useImageFiles,
  dt as useIsDbReady,
  jt as useItem,
  Xt as useItemProperties,
  Ue as useItemProperty,
  Wt as useItems,
  ie as useLiveQuery,
  gt as useModel,
  ur as useModelProperties,
  fr as useModelProperty,
  ht as useModels,
  xt as useOPFSFiles,
  rr as usePersistedSnapshots,
  Jt as usePublishItem,
  yt as useSchema,
  sr as useSchemas,
  lr as useSeedProtocolSchema,
  tr as useService,
  ft as useServices
};
//# sourceMappingURL=index.js.map
