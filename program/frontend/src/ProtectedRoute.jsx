import { Navigate } from "react-router";

export const ProtectedRoute = ({ children }) => {
  const  user  = localStorage.getItem("accessToken");

  if (!user) {
    // user is not authenticated
    console.log("not auth")
    return <Navigate to="/" />;
  }
  return children;
};