// @fm/render: the render format (render.14). A Scene's layers as flat Float32 buffers, designed so a GPU renderer in
// any language can draw them without the browser (WebGL reads them today): the layout table, the encoder, and the
// shaders that read them.
export { CAP_BUTT, CAP_ROUND, CORNER_ATTRIBUTE, KIND_ORDER, LAYOUT, LAYOUT3D, UNIT_M, UNIT_PX, UNIT_QUAD, type Attribute, type GeometryKind, type KindLayout } from "./layout";
export { FORMAT_MAGIC, FORMAT_VERSION, createEncoder, encodeLayer, readHeader, type EncodedLayer, type Encoder, type Header, type Section } from "./encode";
export { POLYGON_FS, POLYGON_VS, sdfShaders } from "./shaders";
export { CAMERA_BYTES, CAMERA_GLSL, CAMERA_UNIFORM, packCamera, type CameraField } from "./camera";
export { BLEND, CAMERA_BINDING, ENTRY, POLYGON_SLOT, QUAD_SLOT, QUAD_VERTICES, RECORD_SLOT, SAMPLE_COUNT, TARGET_FORMATS, TOPOLOGY, vertexLayout3d, vertexLayouts, type VertexAttributeLayout, type VertexBufferLayout, type VertexFormat } from "./pass";
export { WGSL } from "./wgsl";
export { FACE3D_FS, FACE3D_POLYGON_OFFSET, FACE3D_VS, WGSL_FACE3D } from "./shaders3d";
export { triangles3d } from "./triangles3d";
export { packView3d, view3dUniform, VIEW3D_BYTES, VIEW3D_GLSL, VIEW3D_UNIFORM, type View3dField } from "./view3d";
export { raster3d, type Raster3d } from "./raster3d";
