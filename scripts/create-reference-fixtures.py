"""Generate full-frame reference pixels using PyTorch, with shared tiled SE means.
Run after convert-models.py. This checks the JS stitcher independently of ONNX.
"""
import importlib.util
from pathlib import Path
import numpy as np
import torch
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('conversion',ROOT/'scripts/convert-models.py')
conversion=importlib.util.module_from_spec(spec);spec.loader.exec_module(conversion)
spec=importlib.util.spec_from_file_location('upstream',ROOT/'.model-cache/cugan.py')
upstream=importlib.util.module_from_spec(spec);spec.loader.exec_module(upstream)
y,x=np.mgrid[:49,:67]
source=np.stack([(x*3+y*2+c*40)%256 for c in range(3)]).astype(np.float32)/255
with torch.inference_mode():
 for scale in [2,4]:
  halo=18 if scale==2 else 19;tile=32;pw=96;ph=64
  model=getattr(upstream,f'UpCunet{scale}x')().eval()
  model.load_state_dict(torch.load(ROOT/f'.model-cache/up{scale}x-latest-conservative.pth',map_location='cpu',weights_only=True))
  extended=np.pad(source,((0,0),(halo,ph-source.shape[1]+halo),(halo,pw-source.shape[2]+halo)),mode='reflect')
  patches=[torch.from_numpy(extended[:,j:j+tile+2*halo,i:i+tile+2*halo].copy())[None] for j in range(0,ph,tile) for i in range(0,pw,tile)]
  means=[]
  for stage in range(4):
   graph=conversion.CuganStage(model,stage,scale)
   means.append(torch.stack([graph(p,*means) for p in patches]).mean(0))
  # Apply those same global means in one full-frame forward, with no tile seams.
  full=conversion.CuganStage(model,4,scale)(torch.from_numpy(extended.copy())[None],*means)[0,:,:49*scale,:67*scale]
  pixels=full.clamp(0,1).mul(255).round().byte().permute(1,2,0).numpy()
  Image.fromarray(pixels).save(ROOT/f'tests/fixtures/cugan{scale}-reference.png')
  print(scale,pixels.shape)
