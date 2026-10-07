import importlib.util,inspect,sys,pathlib
p=pathlib.Path(__file__).with_name('test_security_policy.py'); spec=importlib.util.spec_from_file_location('t',p); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
tests=[(n,f) for n,f in inspect.getmembers(m,inspect.isfunction) if n.startswith('test_')]; failed=[]
for n,f in tests:
 try: f(); print('PASS',n)
 except Exception as e: failed.append((n,str(e))); print('FAIL',n,e)
print(f'{len(tests)-len(failed)}/{len(tests)} passed'); sys.exit(1 if failed else 0)
