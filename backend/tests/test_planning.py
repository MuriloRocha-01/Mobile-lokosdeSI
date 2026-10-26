"""Planejamento em banco temporário, sem dados reais."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from datetime import date
from decimal import Decimal

TEMP = tempfile.TemporaryDirectory()
os.environ['DATA_ROOT'] = TEMP.name
os.environ['DATABASE_FILE'] = str(Path(TEMP.name) / 'planning.db')
os.environ['UPDATES_ROOT'] = str(Path(TEMP.name) / 'updates')
os.environ['JWT_SECRET'] = 'test-only-planning-secret-1234567890'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.database import init_db, SessionLocal, engine
from app.models import Transaction, CardCycle
from app.routers import auth_routes, finance_routes, profile_routes, planning_routes

app = FastAPI()
for router in (auth_routes.router, finance_routes.router, profile_routes.router, planning_routes.router):
    app.include_router(router)
init_db()
client = TestClient(app)

class PlanningTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import patch
        clock_patch = patch("app.routers.finance_routes.finance_today", return_value=date(2030, 1, 1))
        clock_patch.start()
        self.addCleanup(clock_patch.stop)
        self.headers = []
        for suffix in ('a', 'b'):
            r = client.post('/auth/register', json={'name':'Teste', 'email':f'{self._testMethodName}{suffix}@example.test', 'password':'Test-only-123'})
            self.assertEqual(r.status_code, 201, r.text)
            self.headers.append({'Authorization':'Bearer ' + r.json()['access_token']})
        self.a, self.b = self.headers
        cats = client.get('/finance/categories', headers=self.a).json()
        self.expense = next(c['id'] for c in cats if c['type']=='expense')
        self.income = next(c['id'] for c in cats if c['type']=='income')
        self.card = client.post('/finance/cards', headers=self.a, json={'name':'Teste','last_four':'1234'}).json()['id']

    def create(self, **kw):
        payload = {'description':'Teste','amount':100,'type':'expense','category_id':self.expense,'date':'2030-01-01','payment_method':'cash', **kw}
        r = client.post('/finance/transactions', headers=self.a, json=payload)
        self.assertEqual(r.status_code,201,r.text)
        return r.json()

    def plan(self, today='2030-01-01', headers=None):
        r = client.get('/finance/planning?today='+today, headers=headers or self.a)
        self.assertEqual(r.status_code,200,r.text)
        return r.json()

    def test_deleted_recurrence_stays_deleted(self):
        anchor=self.create(amount=10,date='2026-01-01',recurrence='monthly')
        rows=client.get('/finance/transactions?limit=500',headers=self.a).json()['items']
        children=[row for row in rows if row['recurrence_parent_id']==anchor['id']]
        self.assertTrue(children)
        latest=max(children,key=lambda row:row['date'])
        client.delete('/finance/transactions/'+str(latest['id']),headers=self.a)
        rows=client.get('/finance/transactions?limit=500',headers=self.a).json()['items']
        self.assertFalse(any(row['recurrence_parent_id']==anchor['id'] and row['date']==latest['date'] for row in rows))
        snapshot=self.plan('2026-10-01')
        self.assertIsInstance(snapshot['forecast'],list)

    def test_cycles(self):
        for closing, due, purchase, expected in [(25,5,'2029-12-25','2030-01-05'),(25,5,'2029-12-26','2030-02-05'),(10,20,'2030-01-10','2030-01-20'),(10,20,'2030-01-11','2030-02-20'),(31,31,'2028-02-29','2028-03-31'),(30,31,'2028-02-29','2028-03-31')]:
            self.assertEqual(planning_routes.invoice_due(date.fromisoformat(purchase),CardCycle(closing_day=closing,due_day=due)).isoformat(),expected)

    def test_budgets_and_ownership(self):
        path='/finance/planning/budgets/'+str(self.expense)
        self.assertEqual(client.put(path,headers=self.a,json={'amount':250}).status_code,200)
        self.create(amount=30)
        self.create(amount=99,date='2030-02-01')
        budget=next(x for x in self.plan()['budgets'] if x['category_id']==self.expense)
        self.assertEqual((budget['limit'],budget['spent']),(250,30))
        self.assertTrue(all(x['limit'] is None for x in self.plan(headers=self.b)['budgets']))
        self.assertEqual(client.put(path,headers=self.a,json={'amount':0}).status_code,422)
        self.assertEqual(client.put('/finance/planning/budgets/'+str(self.income),headers=self.a,json={'amount':100}).status_code,400)
        self.assertEqual(client.put('/finance/planning/cards/'+str(self.card),headers=self.b,json={'closing_day':10,'due_day':20}).status_code,404)
        self.assertEqual(client.put('/finance/planning/cards/'+str(self.card),headers=self.a,json={'closing_day':32,'due_day':20}).status_code,422)
        self.assertEqual(client.get('/finance/planning?today=2030-01-01').status_code,401)
        client.delete(path,headers=self.b)
        self.assertIsNotNone(next(x for x in self.plan()['budgets'] if x['category_id']==self.expense)['limit'])
        client.delete(path,headers=self.a)
        self.assertIsNone(next(x for x in self.plan()['budgets'] if x['category_id']==self.expense)['limit'])

    def test_forecast_and_invoice_no_double_count(self):
        client.put('/finance/planning/cards/'+str(self.card),headers=self.a,json={'closing_day':10,'due_day':20})
        self.create(amount=1000,type='income',category_id=self.income)
        self.create(amount=100,date='2030-01-10',payment_method='credit_card',card_id=self.card)
        self.create(amount=60,date='2030-01-11',payment_method='credit_card',card_id=self.card)
        self.create(amount=20,date='2030-01-11',payment_method='debit_card',card_id=self.card)
        result=self.plan()
        self.assertEqual(result['opening'],1000)
        self.assertEqual(result['forecast'][0]['expense'],120)
        self.assertEqual(result['forecast'][0]['balance'],880)
        self.assertEqual(result['forecast'][1]['expense'],60)
        self.assertEqual(result['forecast'][1]['balance'],820)
        totals={row['month']:row['total'] for row in result['invoices']}
        self.assertEqual(totals,{'2030-01':100,'2030-02':60})
        self.assertEqual(self.plan(headers=self.b)['invoices'],[])

    def test_installments_rounding_interest_and_delete(self):
        payload={'description':'Tênis','amount':100,'count':3,'date':'2030-01-31','type':'expense','category_id':self.expense,'payment_method':'cash'}
        r=client.post('/finance/planning/installments',headers=self.a,json=payload)
        self.assertEqual(r.status_code,201,r.text)
        ids=r.json()['ids']
        rows=[client.get('/finance/transactions/'+str(i),headers=self.a).json() for i in ids]
        self.assertEqual([x['date'] for x in rows],['2030-01-31','2030-02-28','2030-03-31'])
        self.assertEqual([x['amount'] for x in rows],[33.34,33.33,33.33])
        self.assertEqual(client.put('/finance/transactions/'+str(ids[0]),headers=self.a,json={'recurrence':'monthly'}).status_code,400)
        r=client.post('/finance/planning/installments',headers=self.a,json={**payload,'amount':1200,'count':12,'installment_amount':110})
        self.assertEqual((r.json()['total'],r.json()['interest']),(1320,120))
        self.assertEqual(client.post('/finance/planning/installments',headers=self.a,json={**payload,'installment_amount':1}).status_code,400)
        self.assertEqual(client.post('/finance/planning/installments',headers=self.a,json={**payload,'count':0}).status_code,422)
        self.assertEqual(client.post('/finance/planning/installments',headers=self.a,json={**payload,'amount':0.01}).status_code,400)
        self.assertEqual(client.delete('/finance/transactions/'+str(ids[0]),headers=self.b).status_code,404)
        self.assertEqual(client.delete('/finance/transactions/'+str(ids[0]),headers=self.a).status_code,204)
        self.assertEqual(client.get('/finance/transactions/'+str(ids[1]),headers=self.a).status_code,200)
        income=self.create(type='income',category_id=self.income)
        self.assertEqual(client.delete('/finance/transactions/'+str(income['id']),headers=self.a).status_code,204)

    def test_credit_installments_keep_the_due_month(self):
        client.put('/finance/planning/cards/'+str(self.card),headers=self.a,json={'closing_day':10,'due_day':20})
        payload={'amount':120,'count':3,'date':'2030-01-20','type':'expense','category_id':self.expense,'payment_method':'credit_card','card_id':self.card}
        bad=client.post('/finance/planning/installments',headers=self.a,json={**payload,'date':'2030-01-21'})
        self.assertEqual(bad.status_code,400)
        self.assertEqual(client.post('/finance/planning/installments',headers=self.b,json=payload).status_code,404)
        result=client.post('/finance/planning/installments',headers=self.a,json=payload)
        self.assertEqual(result.status_code,201,result.text)
        first=client.get('/finance/transactions/'+str(result.json()['ids'][0]),headers=self.a).json()
        self.assertEqual((first['installment_number'],first['installment_count']),(1,3))
        plan=self.plan()
        self.assertEqual([m['expense'] for m in plan['forecast']],[40,40,40,0,0,0])
        self.assertEqual({m['month']:m['total'] for m in plan['invoices']},{'2030-01':40,'2030-02':40,'2030-03':40})

    def test_future_recurring_projection_is_not_persisted(self):
        anchor=self.create(amount=50,date='2030-01-31',recurrence='monthly',recurrence_until='2030-03-31')
        result=self.plan('2030-01-01')
        self.assertEqual([r['expense'] for r in result['forecast']],[50,50,50,0,0,0])
        with SessionLocal() as db:
            from sqlalchemy import select
            self.assertEqual(len(list(db.scalars(select(Transaction).where(Transaction.recurrence_parent_id==anchor['id'])))),0)
        self.assertEqual(client.get('/finance/planning?today=2030-01-01&months=13',headers=self.a).status_code,422)

if __name__=='__main__':
    try:
        result = unittest.main(exit=False).result
        if not result.wasSuccessful(): sys.exit(1)
    finally:
        engine.dispose()
        TEMP.cleanup()
