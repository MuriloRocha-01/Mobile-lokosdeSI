"""Integração em banco temporário: nunca usa o banco configurado do usuário."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from datetime import date

TEMP = tempfile.TemporaryDirectory()
os.environ['DATA_ROOT'] = TEMP.name
os.environ['DATABASE_FILE'] = str(Path(TEMP.name) / 'test.db')
os.environ['UPDATES_ROOT'] = str(Path(TEMP.name) / 'updates')
os.environ['JWT_SECRET'] = 'test-only-secret-not-used-in-production-123456'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.database import init_db, engine, _migrate
from app.routers import auth_routes, finance_routes, profile_routes, updates_routes

app = FastAPI()
for router in (auth_routes.router, finance_routes.router, profile_routes.router, updates_routes.router):
    app.include_router(router)
init_db()
client = TestClient(app)

class MobileTests(unittest.TestCase):
    @unittest.skipUnless(engine.dialect.name == 'sqlite', 'backup em arquivo só existe no SQLite')
    def test_backup_before_migration(self):
        import sqlite3
        from unittest.mock import patch
        from app.database import backup_before_mobile_migration
        folder = Path(TEMP.name) / 'legacy'
        folder.mkdir()
        path = folder / 'database.db'
        with sqlite3.connect(path) as conn:
            conn.execute('CREATE TABLE transactions (id INTEGER, amount NUMERIC)')
            conn.execute('INSERT INTO transactions VALUES (1, 25)')
        with patch('app.database.DATABASE_FILE', path):
            backup_before_mobile_migration()
        backups = list(folder.glob('before-mobile-*.db'))
        self.assertEqual(len(backups), 1)
        with sqlite3.connect(backups[0]) as conn:
            self.assertEqual(conn.execute('SELECT amount FROM transactions').fetchone()[0],25)

    def test_legacy_migration(self):
        from sqlalchemy import create_engine
        from unittest.mock import patch
        legacy = create_engine('sqlite://')
        with legacy.begin() as conn:
            conn.exec_driver_sql('CREATE TABLE users (id INTEGER PRIMARY KEY, is_admin BOOLEAN)')
            conn.exec_driver_sql('CREATE TABLE transactions (id INTEGER PRIMARY KEY, amount NUMERIC)')
            conn.exec_driver_sql('INSERT INTO transactions (id, amount) VALUES (1, 12.34)')
        with patch('app.database.engine', legacy):
            _migrate(); _migrate()
        with legacy.connect() as conn:
            row = conn.exec_driver_sql('SELECT amount, payment_method, card_id FROM transactions WHERE id=1').one()
            self.assertEqual(tuple(row), (12.34, None, None))
        legacy.dispose()

    def test_full_flow(self):
        def register(email):
            response = client.post('/auth/register', json={'name':'Pessoa teste','email':email,'password':'Test-only-123'})
            self.assertEqual(response.status_code, 201, response.text)
            return {'Authorization': 'Bearer ' + response.json()['access_token']}
        a, b = register('a@example.test'), register('b@example.test')
        self.assertIsNone(client.get('/auth/profile', headers=a).json())
        profile = {'name':'Maria Teste','salary_day':31,'bills_day':10,'cycle_day':31,'photo':None,'card':{'name':'Meu cartão','last_four':'1234'}}
        self.assertEqual(client.put('/auth/profile', headers=a,json=profile).status_code,200)
        self.assertEqual(client.put('/auth/profile', headers=a,json=profile).status_code,200)
        cards = client.get('/finance/cards',headers=a).json()
        self.assertEqual(len(cards),1)
        self.assertEqual(client.get('/finance/cards',headers=b).json(),[])
        card = cards[0]['id']
        self.assertEqual(client.put('/auth/profile',headers=a,json={**profile,'salary_day':32}).status_code,422)
        self.assertEqual(client.put('/auth/profile',headers=a,json={**profile,'photo':'data:image/jpeg;base64,bm90YW5pbWFnZQ=='}).status_code,400)
        categories=client.get('/finance/categories',headers=a).json()
        income=next(c['id'] for c in categories if c['type']=='income')
        expense=next(c['id'] for c in categories if c['type']=='expense')
        tx={'amount':100,'date':'2026-10-01','type':'income','category_id':income,'payment_method':'pix','card_id':card}
        response=client.post('/finance/transactions',headers=a,json=tx)
        self.assertEqual(response.status_code,201,response.text)
        response=client.post('/finance/transactions',headers=b,json=tx)
        self.assertEqual(response.status_code,404,response.text)
        out={**tx,'type':'expense','category_id':expense,'amount':25,'payment_method':'debit_card'}
        response=client.post('/finance/transactions',headers=a,json=out)
        self.assertEqual(response.status_code,201,response.text)
        transaction_id=response.json()['id']
        self.assertEqual(client.put(f'/finance/transactions/{transaction_id}',headers=a,json={'time':'09:35'}).status_code,200)
        self.assertEqual(client.put(f'/finance/transactions/{transaction_id}',headers=a,json={'time':'25:00'}).status_code,422)
        snapshot=client.get('/finance/widget?today=2026-10-15',headers=a)
        self.assertEqual(snapshot.status_code,200,snapshot.text)
        data=snapshot.json()
        self.assertEqual((data['balance'],data['income'],data['expense']),(75,100,25))
        self.assertEqual(data['recent'][0]['time'],'09:35')
        self.assertEqual(len(data['days']),31)
        self.assertEqual(data['days'][0]['expense'],25)
        self.assertEqual(data['days'][1]['expense'],0)
        self.assertEqual(client.get('/finance/widget?today=2026-10-15',headers=b).json()['balance'],0)
        self.assertEqual(client.get('/finance/widget?today=2026-10-15').status_code,401)
        self.assertEqual(len(client.get('/finance/widget?today=2024-02-29',headers=a).json()['days']),29)
        self.assertEqual(client.get('/finance/widget?today=2026-10-32',headers=a).status_code,422)
        future=client.post('/finance/transactions',headers=a,json={**out,'date':'2026-10-30','amount':200}).json()
        data=client.get('/finance/widget?today=2026-10-15',headers=a).json()
        self.assertEqual(data['balance'],75)
        self.assertEqual(len(data['recent']),1)
        self.assertEqual(future['status'], 'pending')
        self.assertEqual(data['days'][29]['expense'],0)
        client.delete('/finance/transactions/'+str(future['id']),headers=a)
        updated=client.put(f'/finance/transactions/{transaction_id}',headers=a,json={'amount':25}).json()
        self.assertEqual(updated['time'],'09:35')
        self.assertIsNone(client.put(f'/finance/transactions/{transaction_id}',headers=a,json={'time':None}).json()['time'])
        balance=client.get('/finance/cards?today=2026-10-15',headers=a).json()[0]['balance']
        self.assertEqual(balance,75)
        self.assertEqual(client.post('/finance/transactions',headers=a,json={**out,'card_id':None}).status_code,400)
        self.assertEqual(client.post('/finance/transactions',headers=a,json={**out,'payment_method':'cash'}).status_code,400)
        response=client.get(f'/finance/transactions?payment_method=debit_card&card_id={card}&category_id={expense}',headers=a)
        self.assertEqual(response.json()['total'],1,response.text)
        flow=client.get(f'/finance/cashflow?start=2026-10-01&end=2026-10-31&card_id={card}&type=expense&payment_method=debit_card',headers=a).json()
        self.assertEqual((flow['income'],flow['expense']),(0,25))
        summary=client.get('/finance/summary?cycle=true&today=2026-10-15',headers=a)
        self.assertEqual(summary.status_code,200,summary.text)
        self.assertEqual(summary.json()['start'],'2026-09-30')
        self.assertEqual(summary.json()['end'],'2026-10-30')
        self.assertEqual(summary.json()['expenses_by_card'][0]['total'],25)
        self.assertEqual(client.put(f'/finance/transactions/{transaction_id}',headers=a,json={'payment_method':'cash','card_id':None}).status_code,200)
        self.assertEqual(client.get('/finance/cards?today=2026-10-15',headers=a).json()[0]['balance'],100)
        self.assertEqual(client.put(f'/finance/transactions/{transaction_id}',headers=b,json={'amount':1}).status_code,404)
        # Lançamentos antigos continuam aceitos, sem forma/cartão inventados.
        self.assertEqual(client.post('/finance/transactions',headers=a,json={'amount':3,'type':'expense','category_id':expense,'date':'2026-10-02'}).status_code,201)
        recurring=client.post('/finance/transactions',headers=a,json={**out,'date':'2026-08-15','recurrence':'monthly','recurrence_until':'2026-09-15'})
        self.assertEqual(recurring.status_code,201,recurring.text)
        rows=client.get('/finance/transactions?from=2026-09-01&to=2026-09-30',headers=a).json()['items']
        self.assertTrue(any(t['recurrence_parent_id']==recurring.json()['id'] and t['card_id']==card and t['payment_method']=='debit_card' for t in rows))
        _migrate(); _migrate()
        self.assertIsNone(client.get('/updates/mobile/manifest').json())
        root = Path(os.environ['UPDATES_ROOT'])
        root.mkdir(exist_ok=True)
        release = dict(version='1.3.0',build_number=4,min_build_number=4,android_apk='mobile-4.apk',md5='a'*32,notes='')
        (root/'mobile.json').write_text(json.dumps(release))
        self.assertEqual(client.get('/updates/mobile/manifest').status_code,503)
        (root/'mobile-4.apk').write_bytes(b'test fixture')
        self.assertEqual(client.get('/updates/mobile/manifest').json(),release)
        (root/'mobile.json').write_text(json.dumps({**release,'android_apk':'../unsafe.apk'}))
        self.assertEqual(client.get('/updates/mobile/manifest').status_code,503)
        next_cycle=client.get('/finance/summary?cycle=true&today=2026-10-31',headers=a).json()
        self.assertEqual(next_cycle['income'],0)
        self.assertEqual(next_cycle['expense'],0)
        self.assertEqual(client.get('/finance/cards?today=2026-10-31',headers=a).json()[0]['balance'],75)

        self.assertEqual(finance_routes._cycle_range(date(2024,2,29),31),(date(2024,2,29),date(2024,3,30)))
        self.assertEqual(finance_routes._cycle_range(date(2025,2,28),31),(date(2025,2,28),date(2025,3,30)))

if __name__=='__main__':
    try:
        result = unittest.main(exit=False).result
        if not result.wasSuccessful(): sys.exit(1)
    finally: engine.dispose(); TEMP.cleanup()
