"""Reproducible FP32 browser graphs. Run with the model requirements / Python 3.12.

Upstream files and weights are content-addressed by model-sources.lock.json.
RealCUGAN adaptation follows bilibili's MIT licensed forward_gap_sync (alpha=1).
SRVGG follows Xintao Wang's BSD-3-Clause architecture; PReLU is expanded exactly.
"""
import argparse
import hashlib
import importlib.util
import json
import urllib.request
import warnings
import zipfile
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.tools.symbolic_shape_infer import SymbolicShapeInference
import torch
from torch import nn
from torch.nn import functional as F

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.model-cache'
OUT = ROOT / 'public/models'
VERIFY = ROOT / 'artifacts/models'
torch.set_num_threads(4)
warnings.filterwarnings('ignore', category=DeprecationWarning)
NEAREST_KERNELS = {s: torch.eye(3).repeat_interleave(s*s, dim=0).reshape(3*s*s,3,1,1) for s in [2,4]}


def nearest_integer(x, scale):
    # Legacy WebGL's Resize only implements linear interpolation. A fixed
    # one-hot 1x1 Conv + DepthToSpace is exactly integer nearest-neighbor.
    return F.pixel_shuffle(F.conv2d(x, NEAREST_KERNELS[scale]), scale)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sources():
    lock = json.loads((ROOT / 'scripts/model-sources.lock.json').read_text())
    CACHE.mkdir(exist_ok=True)
    for name, info in lock.items():
        path = CACHE / name
        if not path.exists():
            print('Download', name, flush=True)
            path.write_bytes(urllib.request.urlopen(info['url'], timeout=120).read())
        if digest(path) != info['sha256']:
            raise RuntimeError(f'Source checksum mismatch: {name}')
    return lock


class BrowserPReLU(nn.PReLU):
    def forward(self, x):
        # Same per-channel weights / state_dict as nn.PReLU, with GPU-supported ops.
        return F.relu(x) - self.weight.reshape(1, -1, 1, 1) * F.relu(-x)


class SRVGG(nn.Module):
    def __init__(self, num_conv, browser=False):
        super().__init__()
        self.browser = browser
        activation = BrowserPReLU if browser else nn.PReLU
        self.body = nn.ModuleList([nn.Conv2d(3, 64, 3, 1, 1), activation(64)])
        for _ in range(num_conv):
            self.body.extend([nn.Conv2d(64, 64, 3, 1, 1), activation(64)])
        self.body.append(nn.Conv2d(64, 48, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(4)

    def forward(self, x):
        z = x
        for layer in self.body:
            z = layer(z)
        return self.upsampler(z) + (nearest_integer(x,4) if self.browser else F.interpolate(x, scale_factor=4, mode='nearest'))


class CuganStage(nn.Module):
    def __init__(self, model, stage, scale):
        super().__init__()
        self.model, self.stage, self.scale = model, stage, scale

    def forward(self, x, *means):
        m = self.model
        a, b = m.unet1.forward_a(x)
        if self.stage == 0:
            return b.mean((2, 3), keepdim=True)
        b = m.unet1.conv2.seblock.forward_mean(b, means[0])
        first = m.unet1.forward_b(a, b)
        c, d = m.unet2.forward_a(first)
        if self.stage == 1:
            return d.mean((2, 3), keepdim=True)
        d = m.unet2.conv2.seblock.forward_mean(d, means[1])
        d, e = m.unet2.forward_b(d)
        if self.stage == 2:
            return e.mean((2, 3), keepdim=True)
        e = m.unet2.conv3.seblock.forward_mean(e, means[2])
        f = m.unet2.forward_c(d, e)
        if self.stage == 3:
            return f.mean((2, 3), keepdim=True)
        f = m.unet2.conv4.seblock.forward_mean(f, means[3])
        result = m.unet2.forward_d(c, f) + first[:, :, 20:-20, 20:-20]
        if self.scale == 4:
            result = m.conv_final(result)
            result = m.ps(result[:, :, 1:-1, 1:-1])
            result = result + nearest_integer(x[:, :, 19:-19, 19:-19], 4)
        return result


def session(path):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    return ort.InferenceSession(str(path), options, providers=['CPUExecutionProvider'])


records, cases, results = {}, [], []


def record(name):
    path = OUT / name
    graph = onnx.load(str(path))
    onnx.checker.check_model(graph)
    records[name] = {'bytes': path.stat().st_size, 'sha256': digest(path)}


def portable_constants(graph):
    # WebGL casts ONNX int64 constants to int32. Slice's unbounded sentinels
    # can be safely narrowed because image / activation extents are far smaller.
    tensors = list(graph.graph.initializer)
    for node in graph.graph.node:
        tensors.extend(a.t for a in node.attribute if a.type == onnx.AttributeProto.TENSOR)
    for tensor in tensors:
        if tensor.data_type == onnx.TensorProto.INT64:
            array = onnx.numpy_helper.to_array(tensor)
            clipped = np.clip(array, -2147483647, 2147483647)
            if not np.array_equal(array, clipped):
                tensor.CopyFrom(onnx.numpy_helper.from_array(clipped, tensor.name))
    return graph


def add_case(name, inputs, expected):
    spec = {'name': name, 'file': name + '.onnx', 'inputs': {}, 'output': {}}
    for key, value in inputs.items():
        filename = f'{name}-{key}.f32'
        np.asarray(value, dtype='<f4').tofile(VERIFY / filename)
        spec['inputs'][key] = {'file': filename, 'dims': list(value.shape)}
    filename = f'{name}-output.f32'
    np.asarray(expected, dtype='<f4').tofile(VERIFY / filename)
    spec['output'] = {'file': filename, 'dims': list(expected.shape)}
    cases.append(spec)


def export(name, model, args, expected=None, dynamic=True):
    path = OUT / (name + '.onnx')
    inputs = ['input'] + [f'mean{i}' for i in range(len(args)-1)]
    axes = {'input': {2: 'height', 3: 'width'}, 'output': {2: 'out_height', 3: 'out_width'}} if dynamic else None
    with torch.inference_mode():
        torch.onnx.export(model, args, str(path), input_names=inputs, output_names=['output'],
                          dynamic_axes=axes, opset_version=13, dynamo=False, do_constant_folding=True)
        if expected is None:
            expected = model(*args).numpy()
    onnx.save(portable_constants(onnx.load(str(path))), str(path))
    feeds = {k: v.numpy() for k, v in zip(inputs, args)}
    actual = session(path).run(None, feeds)[0]
    error = float(np.abs(actual-expected).mean())
    if error > 1e-4:
        raise RuntimeError(f'{name}: MAE {error} exceeds 1e-4')
    results.append({'model': name, 'cpuMAE': error, 'maxError': float(np.max(np.abs(actual-expected)))})
    record(path.name)
    add_case(name, feeds, expected)
    print(name, records[path.name]['bytes'], 'CPU MAE', error, flush=True)


def main():
    sources()
    OUT.mkdir(parents=True, exist_ok=True)
    VERIFY.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(114)
    # SRVGG fixtures have odd dimensions to exercise actual shape handling.
    for slug, num_conv in [('realesr-general-x4v3', 32), ('realesr-animevideov3', 16)]:
        weight = torch.load(CACHE / (slug+'.pth'), map_location='cpu', weights_only=True)
        weight = weight.get('params_ema', weight.get('params', weight))
        model, reference = SRVGG(num_conv, True).eval(), SRVGG(num_conv).eval()
        model.load_state_dict(weight)
        reference.load_state_dict(weight)
        x = torch.from_numpy(rng.random((1, 3, 29, 37), dtype=np.float32))
        with torch.inference_mode():
            expected = reference(x).numpy()
        export(slug, model, (x,), expected)

    spec = importlib.util.spec_from_file_location('upstream_cugan', CACHE / 'cugan.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original_pad = F.pad
    def browser_pad(value, pad, mode='constant', fill=None):
        if len(pad) == 4 and all(p <= 0 for p in pad):
            return value[:, :, -pad[2]:(pad[3] or None), -pad[0]:(pad[1] or None)]
        return original_pad(value, pad, mode, fill)
    # A crop is a Slice; exporting it as negative Pad leaves an optional empty
    # input that the legacy WebGL loader rejects. Preserve all crop coordinates.
    F.pad = browser_pad
    with zipfile.ZipFile(CACHE / 'updated_weights.zip') as archive:
        for scale in [2, 4]:
            filename = f'up{scale}x-latest-conservative.pth'
            weight_path = CACHE / filename
            weight_path.write_bytes(archive.read('updated_weights/'+filename))
            model = getattr(module, f'UpCunet{scale}x')().eval()
            model.load_state_dict(torch.load(weight_path, map_location='cpu', weights_only=True))
            core, halo = 32, 18 if scale == 2 else 19
            x = torch.from_numpy(rng.random((1, 3, core+2*halo, core+2*halo), dtype=np.float32))
            means = []
            with torch.inference_mode():
                for stage in range(5):
                    graph = CuganStage(model, stage, scale).eval()
                    export(f'cugan{scale}-stage{stage}', graph, (x, *means))
                    if stage < 4:
                        means.append(graph(x, *means))
                # Independent upstream full forward matches one-tile external-mean graph.
                first = model.unet1(x)
                reference = model.unet2(first) + first[:, :, 20:-20, 20:-20]
                if scale == 4:
                    reference = model.conv_final(reference)
                    reference = model.ps(reference[:, :, 1:-1, 1:-1])
                    reference += F.interpolate(x[:, :, 19:-19, 19:-19], scale_factor=4, mode='nearest')
                actual = CuganStage(model, 4, scale)(x, *means)
                error = float((actual-reference).abs().mean())
                assert error <= 1e-4, error
                results.append({'model': f'cugan{scale}-upstream', 'cpuMAE': error})

    # Exact fixed-shape rewrite: only remove ceil mode where inferred input is even.
    original = CACHE / 'u2netp.onnx'
    graph = SymbolicShapeInference.infer_shapes(onnx.load(str(original)), auto_merge=True)
    shapes = {v.name: [d.dim_value for d in v.type.tensor_type.shape.dim]
              for v in [*graph.graph.input, *graph.graph.value_info, *graph.graph.output]}
    rewritten = 0
    for node in graph.graph.node:
        if node.op_type != 'MaxPool':
            continue
        for attr in node.attribute:
            if attr.name == 'ceil_mode' and attr.i:
                dims = shapes[node.input[0]][-2:]
                if not all(d > 0 and d % 2 == 0 for d in dims):
                    raise RuntimeError(f'Cannot remove ceil_mode for {node.name}: {dims}')
                attr.i = 0
                rewritten += 1
    path = OUT / 'u2netp.onnx'
    graph.graph.initializer.append(onnx.numpy_helper.from_array(np.array([], dtype=np.float32), 'browser_empty_roi'))
    # Resolve Resize sizes statically. Legacy WebGL cannot reliably evaluate
    # the original Shape/Slice/Concat size subgraphs with empty scale inputs.
    for index, node in enumerate(graph.graph.node):
        if node.op_type == 'Resize':
            data_input = node.input[0]
            before, after = shapes[node.input[0]], shapes[node.output[0]]
            if not all(before) or not all(after):
                raise RuntimeError(f'Unresolved Resize dimensions: {node.name}')
            name = f'browser_resize_scales_{index}'
            scales = np.asarray(after, dtype=np.float32)/np.asarray(before, dtype=np.float32)
            graph.graph.initializer.append(onnx.numpy_helper.from_array(scales, name))
            del node.input[:]
            node.input.extend([data_input, 'browser_empty_roi', name])
    # Keep only fused foreground output; dead side-output Sigmoids can be pruned by ORT.
    del graph.graph.output[1:]
    needed = {value.name for value in graph.graph.output}
    kept = []
    for node in reversed(graph.graph.node):
        if any(name in needed for name in node.output):
            kept.append(node)
            needed.update(node.input)
    del graph.graph.node[:]
    graph.graph.node.extend(reversed(kept))
    initializers = [value for value in graph.graph.initializer if value.name in needed]
    del graph.graph.initializer[:]
    graph.graph.initializer.extend(initializers)
    onnx.save(portable_constants(graph), str(path))
    x = rng.normal(size=(1, 3, 320, 320)).astype(np.float32)
    source_session, target_session = session(original), session(path)
    key = source_session.get_inputs()[0].name
    expected, actual = source_session.run(None, {key: x})[0], target_session.run(None, {key: x})[0]
    error = float(np.abs(expected-actual).mean())
    assert error <= 1e-4, error
    results.append({'model': 'u2netp', 'cpuMAE': error, 'ceilPoolsRewritten': rewritten})
    record(path.name)
    add_case('u2netp', {key: x}, expected)
    print('u2netp', records['u2netp.onnx']['bytes'], 'CPU MAE', error, flush=True)

    manifest = {'version': 1, 'runtimeVersion': '1.30.0', 'precision': 'float32',
                'assetBase': 'https://raw.githubusercontent.com/Zydr114/ImagePreprocessTools/main/public/models/',
                'files': records}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    (VERIFY / 'cases.json').write_text(json.dumps(cases, indent=2)+'\n')
    (VERIFY / 'cpu-report.json').write_text(json.dumps(results, indent=2)+'\n')
    licenses = ROOT / 'public/licenses'
    licenses.mkdir(exist_ok=True)
    for key in ['cugan', 'esrgan', 'u2net']:
        (licenses / (key+'.txt')).write_bytes((CACHE / (key+'.LICENSE')).read_bytes())
    print('Exported', len(records), 'graphs;', sum(v['bytes'] for v in records.values()), 'bytes')


if __name__ == '__main__':
    main()
