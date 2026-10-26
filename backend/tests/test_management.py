"""Estados financeiros e reservas: sempre em banco temporário."""
import sys
import unittest
from datetime import date
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
import test_planning as fixture
from app.database import engine

client = fixture.client

class ManagementTests(unittest.TestCase):
    setUp = fixture.PlanningTests.setUp
    create = fixture.PlanningTests.create
    plan = fixture.PlanningTests.plan

    def overview(self, headers=None):
        r = client.get('/finance/planning/overview?today=2030-01-01', headers=headers or self.a)
        self.assertEqual(r.status_code,200,r.text)
        return r.json()

    def test_paid_pending_and_actual_date(self):
        tx=self.create(amount=100, date='2029-12-01', status='pending')
        self.assertEqual(self.overview()['balance'],0)
        self.assertEqual(self.overview()['pending']['expense'],100)
        self.assertEqual(self.plan()['forecast'][0]['expense'],100)
        r=client.put('/finance/transactions/'+str(tx['id']),headers=self.a,json={'status':'settled'})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['settled_at'],'2030-01-01')
        self.assertEqual(self.overview()['balance'],-100)
        self.assertEqual(self.plan()['forecast'][0]['expense'],0)
        client.put('/finance/transactions/'+str(tx['id']),headers=self.a,json={'status':'settled'})
        self.assertEqual(self.overview()['balance'],-100)
        december=client.get('/finance/cashflow?start=2029-12-01&end=2029-12-31',headers=self.a).json()
        january=client.get('/finance/cashflow?start=2030-01-01&end=2030-01-31',headers=self.a).json()
        self.assertEqual((december['expense'],january['expense']),(0,100))
        rows=client.get('/finance/transactions?status=settled&from=2030-01-01&to=2030-01-31',headers=self.a).json()
        self.assertEqual(rows['total'],1)
        client.put('/finance/transactions/'+str(tx['id']),headers=self.a,json={'status':'pending'})
        self.assertEqual(self.overview()['balance'],0)
        self.assertEqual(self.plan()['forecast'][0]['expense'],100)
        self.assertEqual(client.put('/finance/transactions/'+str(tx['id']),headers=self.b,json={'status':'settled'}).status_code,404)
        self.assertEqual(client.put('/finance/transactions/'+str(tx['id']),headers=self.a,json={'status':'invalid'}).status_code,422)

    def test_prepaid_future_is_not_counted_twice(self):
        self.create(type='income',category_id=self.income,amount=500)
        tx=self.create(amount=70,date='2030-02-01',status='pending')
        client.put('/finance/transactions/'+str(tx['id']),headers=self.a,json={'status':'settled'})
        result=self.plan()
        self.assertEqual(result['opening'],430)
        self.assertEqual(result['forecast'][1]['expense'],0)
        self.assertEqual(self.overview()['pending']['expense'],0)
        self.assertEqual(client.get('/finance/widget?today=2030-01-01',headers=self.a).json()['balance'],430)

    def test_goals_do_not_change_income_expense(self):
        self.create(type='income',category_id=self.income,amount=1000)
        payload={'name':'Viagem','target':2000,'reserved':600}
        with patch('app.routers.planning_routes.finance_today',return_value=date(2030,1,1)):
            r=client.post('/finance/planning/goals',headers=self.a,json=payload)
            self.assertEqual(r.status_code,201,r.text)
            goal=r.json()['id']
            r=client.put('/finance/planning/goals/'+str(goal),headers=self.a,json=payload)
            self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(client.post('/finance/planning/goals',headers=self.a,json={**payload,'reserved':500}).status_code,409)
            self.assertEqual(client.put('/finance/planning/goals/'+str(goal),headers=self.b,json=payload).status_code,404)
        view=self.overview()
        self.assertEqual((view['balance'],view['reserved'],view['available']),(1000,600,400))
        self.assertEqual(client.get('/finance/transactions',headers=self.a).json()['total'],1)
        self.assertEqual(self.overview(self.b)['goals'],[])
        self.assertEqual(client.delete('/finance/planning/goals/'+str(goal),headers=self.b).status_code,404)
        client.delete('/finance/planning/goals/'+str(goal),headers=self.a)
        self.assertEqual(self.overview()['available'],1000)
        self.assertEqual(client.get('/finance/transactions',headers=self.a).json()['total'],1)

    def test_parallel_reservations_and_release(self):
        self.create(type='income',category_id=self.income,amount=1000)
        with patch('app.routers.planning_routes.finance_today',return_value=date(2030,1,1)):
            def reserve(n):
                return client.post('/finance/planning/goals',headers=self.a,json={'name':str(n),'target':1000,'reserved':600})
            with ThreadPoolExecutor(max_workers=2) as pool:
                replies=list(pool.map(reserve,[1,2]))
            self.assertEqual(sorted(r.status_code for r in replies),[201,409])
            goal=next(r.json()['id'] for r in replies if r.status_code==201)
            self.create(amount=700)
            self.assertEqual(self.overview()['available'],-300)
            r=client.put('/finance/planning/goals/'+str(goal),headers=self.a,json={'name':'Reserva','target':1000,'reserved':0})
            self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(self.overview()['available'],300)
            self.assertEqual(client.post('/finance/planning/goals',headers=self.a,json={'name':' ','target':100,'reserved':0}).status_code,400)
            self.assertEqual(client.post('/finance/planning/goals',headers=self.a,json={'name':'Teste','target':100,'reserved':101}).status_code,400)

    def test_subscriptions_equivalents_and_stop(self):
        monthly=self.create(description='Academia',amount=100,recurrence='monthly')
        self.create(description='Streaming anual',amount=120,recurrence='yearly')
        self.create(description='Encerrada',amount=50,date='2029-01-01',recurrence='monthly',recurrence_until='2029-02-01')
        view=self.overview()
        self.assertEqual((view['monthly'],view['annual']),(110,1320))
        self.assertEqual(len(view['subscriptions']),2)
        client.put('/finance/transactions/'+str(monthly['id']),headers=self.a,json={'recurrence':'none','recurrence_until':None})
        view=self.overview()
        self.assertEqual((view['monthly'],view['annual']),(10,120))
        self.assertEqual(client.get('/finance/transactions/'+str(monthly['id']),headers=self.a).status_code,200)
        self.assertEqual(self.overview(self.b)['subscriptions'],[])
        children=client.get('/finance/transactions?status=pending',headers=self.a).json()['items']
        self.assertTrue(children)
        self.assertTrue(all(t['status']=='pending' for t in children))

    def test_parallel_recurring_reads_do_not_duplicate(self):
        anchor=self.create(amount=12,date='2029-11-01',recurrence='monthly')
        with ThreadPoolExecutor(max_workers=3) as pool:
            replies=list(pool.map(lambda _: client.get('/finance/transactions?limit=500',headers=self.a),range(3)))
        self.assertTrue(all(r.status_code==200 for r in replies))
        rows=client.get('/finance/transactions?limit=500',headers=self.a).json()['items']
        children=[row for row in rows if row['recurrence_parent_id']==anchor['id']]
        self.assertEqual(sorted(row['date'] for row in children),['2029-12-01','2030-01-01'])
        self.assertTrue(all(row['status']=='pending' for row in children))

    def test_legacy_status_migration(self):
        from sqlalchemy import create_engine
        from app.database import _migrate
        old=create_engine('sqlite://')
        with old.begin() as conn:
            conn.exec_driver_sql('CREATE TABLE users (id INTEGER PRIMARY KEY, is_admin BOOLEAN)')
            conn.exec_driver_sql('CREATE TABLE transactions (id INTEGER PRIMARY KEY, date DATE, amount INTEGER)')
            conn.exec_driver_sql("INSERT INTO transactions VALUES (1,'2000-01-01',100),(2,'2100-01-01',200)")
        with patch('app.database.engine',old):
            _migrate(); _migrate()
        with old.connect() as conn:
            rows=conn.exec_driver_sql('SELECT id,status,settled_at,amount FROM transactions ORDER BY id').all()
            self.assertEqual(tuple(rows[0]),(1,'settled','2000-01-01',100))
            self.assertEqual(tuple(rows[1]),(2,'pending',None,200))
        old.dispose()

if __name__=='__main__':
    try:
        result=unittest.main(exit=False).result
        if not result.wasSuccessful(): sys.exit(1)
    finally:
        engine.dispose()
        fixture.TEMP.cleanup()
