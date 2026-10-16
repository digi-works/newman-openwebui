"""Patch the built portal so Settings > AI connection loads at once instead of after ~5 seconds (QA DEF-18).

Usage: python3 apply.py <app dir extracted from digiworks-portal:release> files
`runtimeView` (src/lib/stack/runtime-switch.ts) checked the health of each AI runtime one after the other and waited for each answer:
Strands, which this deployment does not run, only fails after its 5 second timeout, and Open WebUI, when its live connection is not up,
signs in and retries for seconds before answering. Now both checks run at the same time and the page waits at most 1.5 seconds; a
check still running then is shown as "did not answer within 1.5 seconds" and finishes in the background (Open WebUI's connection is
then up for the next load). Server-only change: the runtimeView copy used by the page (ssr) and the one used by the API route.
"""
import pathlib
import sys

WAIT_MS = 1500
SLOW = "did not answer within 1.5 seconds; reload to check again"

# (file, old loop, variable names in that copy: runtime module, names map, unused-capabilities helper, options list, needs)
COPIES = [
    (".next/server/chunks/ssr/src_10p2wf2._.js",
     'for(let a of["owui","strands"]){let b=(0,e.runtimeById)(a),d=await b.health().catch(()=>({ok:!1,detail:"not reachable"})),f=b.capabilities().capabilities;g.push({id:a,name:j[a],ok:d.ok,detail:d.detail,features:f,blockedBy:k(c,f)})}',
     "e", "j", "k", "g", "c"),
    (".next/server/chunks/_019vi_p._.js",
     'for(let e of["owui","strands"]){let t=(0,r.runtimeById)(e),n=await t.health().catch(()=>({ok:!1,detail:"not reachable"})),i=t.capabilities().capabilities;s.push({id:e,name:c[e],ok:n.ok,detail:n.detail,features:i,blockedBy:p(a,i)})}',
     "r", "c", "p", "s", "a"),
]


def new_loop(rt, names, missing, opts, needs):
    ids = '["owui","strands"]'
    return (
        f"let __h=await Promise.all({ids}.map(__id=>Promise.race([(0,{rt}.runtimeById)(__id).health().catch(()=>({{ok:!1,detail:\"not reachable\"}})),"
        f"new Promise(__r=>setTimeout(()=>__r({{ok:!1,detail:\"{SLOW}\"}}),{WAIT_MS}))])));"
        f"for(let[__i,__id]of {ids}.entries()){{let __c=(0,{rt}.runtimeById)(__id).capabilities().capabilities;"
        f"{opts}.push({{id:__id,name:{names}[__id],ok:__h[__i].ok,detail:__h[__i].detail,features:__c,blockedBy:{missing}({needs},__c)}})}}"
    )


app, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
for rel, old, *vars_ in COPIES:
    s = (app / rel).read_text()
    if s.count(old) != 1:
        sys.exit(f"{rel}: expected 1 match, found {s.count(old)}")
    dest = out / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(s.replace(old, new_loop(*vars_)))
    print("wrote", dest)
