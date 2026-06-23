# dwgdxf

Client-side DWG → DXF converter that runs entirely in the browser. Powered by [ACadSharp](https://github.com/DomCR/ACadSharp) compiled to WebAssembly via .NET 9.

Supports DWG versions R14 through R2018 (AC1014–AC1032).

By default, `init()` uses the local `dist/wasm` assets shipped with the package. If you prefer CDN delivery to avoid huge bundle sizes, pass `CDN_WASM_BASE` instead.

```ts
import { init, CDN_WASM_BASE } from 'dwgdxf';
await init({ wasmBase: CDN_WASM_BASE });
```

<br/>
<br/>
<br/>

#### Credits

Parsing and serializing is handled by [ACadSharp](https://github.com/DomCR/ACadSharp) (MIT), an independent open-source C# implementation of the DWG/DXF formats.
