/** Snippet entry: the runtime with only the shader-gradient renderer. */
import { autoMount } from '../core/mount';
import { shaderGradient } from '../renderers/shader-gradient';

autoMount([shaderGradient]);
