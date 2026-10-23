import path from 'node:path';

const PROFILES = {
  'python-math': {
    modules: { numpy: 'numpy', sympy: 'sympy', gmpy2: 'gmpy2', z3: 'z3-solver', Crypto: 'pycryptodome' },
    optional: ['fpylll'], timeoutMs: 15000,
    description: 'Selected interpreter; imports and tiny NumPy, SymPy, gmpy2, Z3 and digest checks. No user program or installation.',
    facts: { sum: 6, sympyGcd: 6, gmpy2Gcd: 6, sat: 'sat' },
    check: `facts['sum'] = int(modules['numpy'].sum([1, 2, 3]))
facts['sympyGcd'] = int(modules['sympy'].gcd(12, 18))
facts['gmpy2Gcd'] = int(modules['gmpy2'].gcd(12, 18))
z3 = modules['z3']
x = z3.Int('seal_toy_integer')
solver = z3.Solver()
solver.add(x == 2, x > 0)
facts['sat'] = str(solver.check())
digest = importlib.import_module('Crypto.Hash.SHA256')
facts['digest'] = digest.new(b'seal-local-check').hexdigest()
assert facts['digest'] == hashlib.sha256(b'seal-local-check').hexdigest()`,
  },
  'python-pwn': {
    modules: { pwnlib: 'pwntools', capstone: 'capstone', unicorn: 'unicorn', elftools: 'pyelftools' },
    optional: ['angr'], timeoutMs: 20000,
    description: 'Selected exploit interpreter; imports and tiny cyclic, disassembly, emulator-construction and ELF-header checks. No target execution or network.',
    facts: { cyclicHex: '6161616162616161', instruction: 'ret', unicornReady: true, elfClass: 64 },
    check: `import io, struct
cyclic = importlib.import_module('pwnlib.util.cyclic').cyclic(8)
facts['cyclicHex'] = bytes(cyclic).hex()
capstone = modules['capstone']
instruction = next(iter(capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64).disasm(b'\\xc3', 0)))
facts['instruction'] = instruction.mnemonic
unicorn = modules['unicorn']
facts['unicornReady'] = bool(unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64))
header = bytearray(64)
header[:7] = bytes.fromhex('7f454c46020101')
struct.pack_into('<HHI', header, 16, 2, 62, 1)
struct.pack_into('<H', header, 52, 64)
elf = importlib.import_module('elftools.elf.elffile').ELFFile(io.BytesIO(header))
facts['elfClass'] = elf.elfclass`,
  },
  'python-files': {
    modules: { PIL: 'Pillow', elftools: 'pyelftools', pefile: 'pefile', yara: 'yara-python' },
    optional: [], timeoutMs: 15000,
    description: 'Local file libraries: imports, in-memory image pixels, ELF header parsing, invalid-PE rejection and a benign YARA rule. No target execution.',
    facts: { pixel: [10, 20, 30], elfClass: 64, invalidPeRejected: true, ruleMatched: true },
    check: `import io, struct
image = importlib.import_module('PIL.Image').new('RGB', (2, 2), (10, 20, 30))
facts['pixel'] = list(image.getpixel((1, 1)))
header = bytearray(64)
header[:7] = bytes.fromhex('7f454c46020101')
struct.pack_into('<HHI', header, 16, 2, 62, 1)
struct.pack_into('<H', header, 52, 64)
elf = importlib.import_module('elftools.elf.elffile').ELFFile(io.BytesIO(header))
facts['elfClass'] = elf.elfclass
facts['invalidPeRejected'] = False
try:
    modules['pefile'].PE(data=b'not-a-PE')
except modules['pefile'].PEFormatError:
    facts['invalidPeRejected'] = True
rules = modules['yara'].compile(source='rule seal_benign { strings: $s = "seal-benign-fixture" condition: $s }')
facts['ruleMatched'] = [match.rule for match in rules.match(data=b'seal-benign-fixture')] == ['seal_benign']`,
  },
  'python-lattice': {
    modules: { fpylll: 'fpylll' }, optional: [], timeoutMs: 15000,
    description: 'fpylll import and a two-by-two integer matrix reduction with determinant verification. No large search or supplied cryptographic input.',
    facts: { determinantMagnitude: 1 },
    check: `matrix = modules['fpylll'].IntegerMatrix.from_matrix([[1, 1], [0, 1]])
modules['fpylll'].LLL.reduction(matrix)
facts['determinantMagnitude'] = abs(int(matrix[0, 0]) * int(matrix[1, 1]) - int(matrix[0, 1]) * int(matrix[1, 0]))`,
  },
  'python-model': {
    modules: { numpy: 'numpy', torch: 'torch', transformers: 'transformers', safetensors: 'safetensors' },
    optional: [], timeoutMs: 30000,
    description: 'CPU-only library imports, a tiny tensor operation and safetensors in-memory round-trip. No downloads, GPU probe or model deserialization.',
    facts: { tensorSum: 10, tensorShape: [2, 2], roundTrip: true },
    check: `numpy = modules['numpy']
torch = modules['torch']
torch.set_num_threads(1)
x = numpy.array([[1, 2], [3, 4]], dtype=numpy.float32)
serializer = importlib.import_module('safetensors.numpy')
y = serializer.load(serializer.save({'x': x}))['x']
facts['roundTrip'] = bool(numpy.array_equal(x, y))
tensor = torch.tensor([[1, 2], [3, 4]]) @ torch.eye(2, dtype=torch.int64)
facts['tensorSum'] = int(tensor.sum())
facts['tensorShape'] = list(tensor.shape)`,
  },
};

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return object(value) && Object.keys(value).every(key => allowed.includes(key));
}

function text(value, maximum = 512) {
  return typeof value === 'string' && value.length <= maximum;
}

export function pythonProfile(id) {
  return Object.hasOwn(PROFILES, id) ? PROFILES[id] : null;
}

export function pythonProbe(id) {
  const profile = pythonProfile(id);
  if (!profile) throw new Error(`Unknown Python environment: ${id}`);
  return `import sys, json, importlib, importlib.util, importlib.metadata, hashlib
names = ${JSON.stringify(profile.modules)}
modules, versions, missing, errors, facts, optional = {}, {}, [], {}, {}, {}
for name, distribution in names.items():
    try:
        modules[name] = importlib.import_module(name)
        versions[distribution] = importlib.metadata.version(distribution)
    except ImportError as exc:
        missing.append(name)
        errors[name] = (type(exc).__name__ + ': ' + str(exc))[:512]
    except Exception as exc:
        errors[name] = (type(exc).__name__ + ': ' + str(exc))[:512]
if not errors:
    try:
${profile.check.split('\n').map(line => `        ${line}`).join('\n')}
        expected = json.loads(${JSON.stringify(JSON.stringify(profile.facts))})
        assert all(facts.get(key) == value for key, value in expected.items())
    except Exception as exc:
        errors['toyChecks'] = (type(exc).__name__ + ': ' + str(exc))[:512]
for name in ${JSON.stringify(profile.optional)}:
    try:
        optional[name] = importlib.util.find_spec(name) is not None
    except Exception:
        optional[name] = False
print(json.dumps({'executable': sys.executable, 'version': sys.version.split()[0], 'versions': versions, 'missingModules': missing, 'errors': errors, 'facts': facts, 'optional': optional}, sort_keys=True))
sys.exit(1 if errors else 0)
`;
}

export function validPythonMetadata(value, id) {
  if (value === null) return true;
  const profile = pythonProfile(id);
  if (!profile) return false;
  const modules = Object.keys(profile.modules);
  const distributions = Object.values(profile.modules);
  const factKeys = [...Object.keys(profile.facts), ...(id === 'python-math' ? ['digest'] : [])];
  return exactKeys(value, ['executable', 'version', 'versions', 'missingModules', 'errors', 'facts', 'optional'])
    && text(value.executable, 4096) && path.isAbsolute(value.executable) && !value.executable.includes('\0')
    && text(value.version) && object(value.versions)
    && Object.entries(value.versions).every(([key, version]) => distributions.includes(key) && text(version))
    && Array.isArray(value.missingModules) && value.missingModules.length <= modules.length
    && value.missingModules.every(name => modules.includes(name))
    && object(value.errors) && Object.entries(value.errors).every(([key, error]) => [...modules, 'toyChecks'].includes(key) && text(error))
    && exactKeys(value.facts, factKeys)
    && Object.values(value.facts).every(fact => typeof fact === 'boolean' || (typeof fact === 'number' && Number.isFinite(fact)) || text(fact)
      || (Array.isArray(fact) && fact.length <= 16 && fact.every(item => typeof item === 'number' && Number.isFinite(item))))
    && exactKeys(value.optional, profile.optional) && profile.optional.every(key => typeof value.optional[key] === 'boolean');
}

export function successfulPython(value, id) {
  const profile = pythonProfile(id);
  return profile !== null && value !== null && validPythonMetadata(value, id)
    && Object.keys(value.errors).length === 0 && value.missingModules.length === 0
    && Object.values(profile.modules).every(name => text(value.versions[name]) && value.versions[name].length > 0)
    && Object.entries(profile.facts).every(([key, expected]) => JSON.stringify(value.facts[key]) === JSON.stringify(expected))
    && (id !== 'python-math' || /^[a-f0-9]{64}$/.test(value.facts.digest));
}
