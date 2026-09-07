# Engine architecture

## Scene representation and ownership

`Store.doc` is the versioned, serializable coordination document. It owns model/entity metadata, transforms, sets, viewpoints, issues, measurements, tests, results and display/section state. `Store.geometries` is a separate immutable-by-convention registry of typed position, normal and index arrays. Commands snapshot the document, not those arrays.

An entity has stable identity and one or more parts. A part references a shared source geometry and its own transform/material. Rendering and coordination compose column-major transforms as:

```text
world = model.matrix × entity.matrix × part.matrix
```

Imported geometry IDs are namespaced by a random model UUID. IDs retain the full UUID; the opaque-context fallback uses `crypto.getRandomValues` with UUID-v4 version and variant bits. IFC GlobalId and ExpressID remain searchable properties rather than being reused as cross-model primary keys.

`Store.rebuild()` regenerates render instances and the scene BVH. It also caches each entity's world AABB so clash-worker synchronization does not rescan every instance for every entity. The scene index is a median-split BVH, not a SAH tree or a dynamic refitting tree. Every document change currently rebuilds it; that is a clear optimization point for very large projects with frequent metadata edits.

## WebGPU rendering

The renderer uses an explicit bind-group/pipeline layout. The uniform buffer contains:

| Byte offset | Field | Size |
|---:|---|---:|
| 0 | View-projection matrix | 64 |
| 64 | Section minimum XYZ + enabled flag | 16 |
| 80 | Section maximum XYZ | 16 |
| 96 | Eye XYZ | 16 |

Total uniform allocation: **112 bytes**.

Each storage-buffer instance occupies **96 bytes**:

| Byte offset | Field | Size |
|---:|---|---:|
| 0 | Column-major model matrix | 64 |
| 64 | RGBA material/override color | 16 |
| 80 | Object ID, selection flag, reserved, reserved | 16 |

Geometry is uploaded once per geometry ID as a 24-byte interleaved position/normal vertex layout and Uint32 indices. The scene groups all visible instances of a shared mesh into one indexed instanced draw. `firstInstance` indexes the contiguous storage-buffer group. The sample needs two geometry batches plus the reference grid.

WGSL transforms positions and computes inverse-transpose normals with the cofactor matrix divided by the determinant. Projection matrices use the OpenGL-style CPU depth convention and are remapped to WebGPU's zero-to-one clip-depth range in the vertex shader. The shaded pass uses a four-sample color/depth target and resolves to the canvas. The ID pass is single-sample.

Clipping uses the six section-box inequalities in the fragment shader. Dithered transparency avoids incorrect mesh-order alpha blending and makes the visible and pick passes use the same alpha test. It is intentionally not physically based transmission or order-independent transparent compositing.

Wireframe uses an edge index buffer. This shows triangle edges, not CAD/BRep feature edges. The grid is a geometric batch, not a background bitmap.

Frames are requested only when state, camera or viewport size changes. Geometry and instance buffers are cached; instance storage grows geometrically and respects `maxStorageBufferBindingSize`. Statistics show submitted triangles, instances, draw groups and CPU submission/render time. They are not GPU timestamp measurements or an FPS benchmark.

### GPU picking

WebGPU renders stable numeric entity IDs to an `r32uint` attachment, with normal depth testing and section/transparency rejection. The pick uses a one-pixel scissor and a 256-byte-aligned readback buffer. `mapAsync` waits for the copy before the Uint32 ID is decoded. The result is mapped back through `Store.byPick`.

Pointer handling rejects stale asynchronous picks when the scene revision or camera changed during readback. The GPU ID identifies the entity; measurement endpoints are then obtained by exact CPU ray/triangle intersection against that entity's visible triangles.

The WebGL2 fallback uses instanced attributes and a 24-bit RGBA8 ID encoding. Dithering is explicitly disabled during the ID pass to preserve exact channel values. It has the same current 2-million-entity project guard as the application, well below the 24-bit limit.

The software backend implements triangle rasterization, depth, perspective-correct world-position clipping and an object-ID buffer. It is a compatibility path, capped at a 1000-pixel internal longest dimension, and is much slower than a GPU renderer. It does not substitute a static image for geometry.

GPU device loss is surfaced to the user with a reload instruction; automatic device recreation is not implemented.

## Incremental coordination

Coordination is CPU/worker-based and independent of what is visible in the viewport.

1. Scope definitions resolve to stable entity ID sets.
2. A worker scene BVH produces cross-scope candidates using AABB overlap expanded by the clearance threshold.
3. A canonical pair key eliminates duplicates when scopes overlap.
4. A world-space triangle mesh and triangle BVH are built lazily for each entity and cached by its geometry/transform stamp.
5. BVH-pair traversal rejects nodes whose lower-bound distance exceeds the threshold or current best witness distance.
6. Leaf triangle pairs use segment/triangle intersection, point/triangle distance and edge/edge distance. Coplanar contact is detected through the distance cases.
7. Closed-component parity checks detect complete containment that surface intersection alone would miss.

The mesh closure heuristic welds positions on a 1e-8 m coordinate grid and checks edge incidence. It does not prove manifold orientation or absence of self-intersection. Parity uses a fixed non-axis ray and coalesces nearly equal hits. These are numerical engineering heuristics; exact-predicate classification is not claimed.

A cached pair result is keyed by canonical IDs, both geometry/transform stamps, mode and threshold. Both positive and negative results are cached. Newly imported geometry is sent only once; transforms and membership descriptors are synchronized when the geometry epoch changes. Replacing a project explicitly resets the worker registry and caches, preventing reused IDs from referencing a prior document.

Cancellation and progress messages are serviced between cooperative yields in candidate generation and pair processing. One very expensive pair can still delay cancellation until its narrow-phase call returns. The app discards results from a stale geometry epoch or changed test configuration. The pair cache is cleared when it grows beyond 100,000 entries. Candidate enumeration stops with an explicit error above 2 million pairs rather than silently truncating a test.

Moving an entity invalidates its cached world mesh and affected pair keys. Unchanged pairs survive. Review status is merged by stable pair ID on rerun. Results after geometry changes are visibly stale until rerun, regardless of retained status.

A hard clash has contact epsilon 1e-6 m. Neither a contact witness nor containment returns penetration depth/volume. Clearance reports are unsigned surface distances within the test threshold. Hidden/sectioned entities remain included according to test scope.

## Worker protocols

The import worker receives local `File` objects and selected sidecars, parses in isolation, then transfers the result's position, normal and index ArrayBuffers back to the main thread. Importers do not share mutable WASM memory with the renderer. The web-ifc adapter copies all required data before deleting geometry handles and closing the model.

The clash worker accepts:

```text
sync   { geometries, entities, revision, reset? }
run    { job, test: { idsA, idsB, mode, clearance, ... } }
cancel { ... }
```

It emits progress and a result/error associated with a job token. The standalone packager embeds classic Blob workers because a single downloaded HTML file cannot rely on external module-worker files. Normal development uses native module workers. Standalone import deliberately selects the offline native IFC path.

## History and persistence

A command records before/after document snapshots and its geometry-change flag. Failure restores the prior document. Successful changes update revision counters, spatial state and subscribers. Undo and redo retain at most 60 entries. Geometry arrays remain outside snapshots. Portable export walks the live document and includes only referenced geometries, even though the in-memory registry can retain orphans for undo.

A transform is an undoable document edit; camera navigation is not individually entered in history. Commands capture current camera state, and viewpoint restoration explicitly records its target camera so undo/redo can restore the corresponding view. Selection itself is transient except inside saved viewpoints and sets.

IndexedDB uses one object store and one autosave record. Writes are serialized, with a 650 ms debounce and transaction completion handling. A save failure is not represented as success. The user can always export a portable JSON project in a browser context that permits downloads.

Portable format:

```json
{
  "format": "converge-studio",
  "version": 1,
  "document": { "schema": 1 },
  "geometries": [
    ["geometry-id", {"positions": [], "normals": [], "indices": []}]
  ]
}
```

The example above shows the container, not a valid empty project: a real document also includes all required collections and section state. `unpack()` validates format versions, affine transforms, references, vertex/index data, hierarchy paths, cameras, section bounds, measurements, tests and result witnesses before replacing the active document. View thumbnails must be embedded raster image data URIs. It does not claim exhaustive validation of every nested metadata field.

## Precision, performance and release boundaries

CPU matrix composition, world-space bounds and distances use JavaScript Number/double arithmetic; source vertex arrays and GPU uploads use Float32. No floating-origin correction, exact arithmetic, out-of-core geometry, LOD, mesh simplification, scene occlusion culling or GPU broad/narrow phase is implemented. Core algorithms are separated into modules specifically so those can be added without rewriting coordination records or UI commands.

The delivered GPU pipelines and WASM adapter require target-browser execution validation. The included successful browser evidence used the software backend, not a silently emulated claim of a WebGPU pass. Browser IndexedDB needs a real-origin reload test; the test environment used an opaque origin.
