import { Navigate } from 'react-router';

/**
 * Shows the page only with a saved token, otherwise goes to the main menu.
 * The server still checks the token on every request.
 *
 * @param {object} props - Component props.
 * @param {object} props.children - The protected page.
 * @returns {object} The page or a redirect.
 */
export const ProtectedRoute = ({ children }) => {
  const user = localStorage.getItem('accessToken');

  if (!user) {
    return <Navigate to="/" />;
  }
  return children;
};
