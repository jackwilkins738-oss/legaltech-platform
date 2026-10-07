import subprocess
import tempfile
import unittest
from pathlib import Path
from repository_files import repository_files

class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.root=Path(self.folder.name)
        subprocess.run(['git','init','-q',str(self.root)],check=True,capture_output=True)
        (self.root/'.gitignore').write_text('.env\n*.sqlite\n/APPLY_*_V[0-9]*.ps1\n/APPLY_V[0-9]*.ps1\n')
    def tearDown(self):
        self.folder.cleanup()
    def names(self):
        return {p.relative_to(self.root).as_posix() for p in repository_files(self.root)}
    def test_ignored_secrets_databases_and_downloads_are_excluded(self):
        for name in ['.env','local.sqlite','APPLY_INBOUND_SAFETY_V40.ps1','APPLY_NEW_V42 (1).ps1']:
            (self.root/name).write_text('synthetic marker')
        self.assertEqual(self.names(),{'.gitignore'})
    def test_new_source_and_unicode_paths_are_included(self):
        (self.root/'new source.js').write_text('source')
        (self.root/'évidence.md').write_text('documentation')
        self.assertEqual(self.names(),{'.gitignore','new source.js','évidence.md'})
    def test_tracked_files_remain_included_even_when_ignored(self):
        (self.root/'APPLY_ARCHIVE_V1.ps1').write_text('# tracked evidence')
        subprocess.run(['git','-C',str(self.root),'add','-f','APPLY_ARCHIVE_V1.ps1'],check=True)
        self.assertIn('APPLY_ARCHIVE_V1.ps1',self.names())
    def test_unrelated_parent_repository_does_not_hide_exported_files(self):
        child=self.root/'archive';child.mkdir();(child/'note.md').write_text('note')
        (child/'.env').write_text('synthetic marker');(child/'.env.example').write_text('example')
        self.assertEqual({p.name for p in repository_files(child)},{'note.md','.env.example'})
    def test_export_fallback_excludes_runtime_and_installers(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'note.md').write_text('note');(root/'APPLY_DEMO_V42.ps1').write_text('# installer')
            (root/'.dev-data').mkdir();(root/'.dev-data'/'secret.json').write_text('{}')
            self.assertEqual({p.name for p in repository_files(root)},{'note.md'})
    def test_prefix_versioned_conflict_download_is_excluded(self):
        (self.root/'APPLY_V42_PR_CONFLICT_FIX.ps1').write_text('# downloaded helper')
        self.assertEqual(self.names(),{'.gitignore'})
    def test_prefix_versioned_download_is_excluded_in_export_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'APPLY_V42_PR_CONFLICT_FIX (1).ps1').write_text('# downloaded helper')
            (root/'note.md').write_text('documentation')
            self.assertEqual({p.name for p in repository_files(root)},{'note.md'})
    def test_tracked_prefix_versioned_source_is_still_preserved(self):
        name='APPLY_V1_ARCHIVED_SOURCE.ps1'
        (self.root/name).write_text('# explicitly tracked source')
        subprocess.run(['git','-C',str(self.root),'add','-f',name],check=True)
        self.assertIn(name,self.names())
    def test_missing_tracked_file_is_not_catalogued(self):
        p=self.root/'source.js';p.write_text('source');subprocess.run(['git','-C',str(self.root),'add','source.js'],check=True);p.unlink()
        self.assertNotIn('source.js',self.names())

if __name__=='__main__':
    unittest.main()
