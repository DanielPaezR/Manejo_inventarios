import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ModuloProvider } from './context/ModuloContext';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Ventas from './components/Ventas';
import Productos from './components/Productos';
import Estadisticas from './components/Estadisticas';
import Negocios from './components/Negocios';
import Reportes from './components/Reportes';
import GestionInventario from './components/GestionInventario';
import Proveedores from './components/Proveedores';
import Pedidos from './components/Pedidos';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (token && userData) {
      try {
        setUser(JSON.parse(userData));
      } catch (error) {
        console.error('Error cargando usuario:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('moduloActivo');
      }
    }
    setLoading(false);
  }, []);

  const login = (userData, token) => {
    setUser(userData);
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    
    // Si el usuario tiene módulos, seleccionar el primero automáticamente
    if (userData.modulos && userData.modulos.length > 0) {
      localStorage.setItem('moduloActivo', JSON.stringify(userData.modulos[0]));
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('moduloActivo');
  };

  if (loading) {
    return <div className="loading">Cargando...</div>;
  }

  return (
    <ModuloProvider>
      <Router>
        <div className="app">
          <Routes>
            <Route 
              path="/login" 
              element={
                !user ? <Login onLogin={login} /> : <Navigate to="/" />
              } 
            />
            <Route 
              path="/" 
              element={
                user ? <Dashboard user={user} onLogout={logout} /> : <Navigate to="/login" />
              } 
            >
              <Route path="ventas" element={<Ventas user={user} />} />
              <Route path="productos" element={<Productos user={user} />} />
              <Route path="estadisticas" element={<Estadisticas user={user} />} />
              <Route path="negocios" element={<Negocios user={user} />} />
              <Route index element={<Navigate to="/ventas" />} />
              <Route path="reportes" element={<Reportes user={user} />} />
              <Route path="inventario" element={<GestionInventario user={user} />} />
              <Route path="proveedores" element={<Proveedores user={user} />} />
              <Route path="pedidos" element={<Pedidos user={user} />} />
            </Route>
          </Routes>
        </div>
      </Router>
    </ModuloProvider>
  );
}

export default App;