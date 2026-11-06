/**
 * The background types the studio knows, in one place: the renderer defs
 * (passed to `mount()`, poster rendering and the gallery) and their display
 * names. Adding a type to the studio starts here; see the README.
 */
import type { BackgroundType, RendererDef } from '@abs/runtime/types';
import { shaderGradient } from '@abs/runtime/renderers/shader-gradient';
import { flowField } from '@abs/runtime/renderers/flow-field';
import { particleMesh } from '@abs/runtime/renderers/particle-mesh';

export const RENDERERS: readonly RendererDef[] = [shaderGradient, flowField, particleMesh];

export const TYPE_NAMES: Record<BackgroundType, string> = {
  'shader-gradient': 'Shader gradient',
  'flow-field': 'Flow field',
  'particle-mesh': 'Particle mesh',
};

export const defFor = (type: BackgroundType): RendererDef => RENDERERS.find((d) => d.type === type)!;
